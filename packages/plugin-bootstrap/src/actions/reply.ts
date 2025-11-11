import {
  type Action,
  type ActionExample,
  composePromptFromState,
  type Content,
  type HandlerCallback,
  type IAgentRuntime,
  type Media,
  type Memory,
  ModelType,
  type State,
  type ActionResult,
  logger,
  parseKeyValueXml,
  ensureCorrelationId,
  isDebugFlagEnabled,
  sanitizeLogPreview,
} from '@elizaos/core';
import { createHash } from 'node:crypto';

const replyTemplate = `# Task: Generate dialog for the character {{agentName}}.

{{providers}}

# Instructions: Write the next message for {{agentName}}.
"thought" should be a short description of what the agent is thinking about and planning.
"message" should be the next message for {{agentName}} which they will send to the conversation.

IMPORTANT CODE BLOCK FORMATTING RULES:
- If {{agentName}} includes code examples, snippets, or multi-line code in the response, ALWAYS wrap the code with \`\`\` fenced code blocks (specify the language if known, e.g., \`\`\`python).
- ONLY use fenced code blocks for actual code. Do NOT wrap non-code text, instructions, or single words in fenced code blocks.
- If including inline code (short single words or function names), use single backticks (\`) as appropriate.
- This ensures the user sees clearly formatted and copyable code when relevant.

Do NOT include any thinking, reasoning, or <think> sections in your response. 
Go directly to the XML response format without any preamble or explanation.

Respond using XML format like this:
<response>
    <thought>Your thought here</thought>
    <message>Your message here</message>
</response>

IMPORTANT: Your response must ONLY contain the <response></response> XML block above. Do not include any text, thinking, or reasoning before or after this XML block. Start your response immediately with <response> and end with </response>.`;

const SNAPSHOT_PROMPT_LIMIT = 2000;
const USER_PROMPT_CHAR_LIMIT = 500;
const RECENT_HISTORY_CHAR_LIMIT = 1200;
const RECENT_HISTORY_SEGMENTS = 2;
const SNAPSHOT_PROMPT_BUDGET_TOKENS = 700;
const DEFAULT_PROMPT_BUDGET_TOKENS = 2000;
const SNAPSHOT_SUMMARY_WORD_LIMIT = Number(process.env.RIP2ETF_SUMMARY_MAX_WORDS ?? 400);
const LLM_PROMPT_WORD_LIMIT = Number(process.env.LLM_MAX_WORDS ?? 1800);
const SNAPSHOT_HINT_REGEX = /(grafico|chart|confront|panoramica|aggiornata|etf|\bvs\b)/i;
const PROMPT_DUMP_ENABLED = isDebugFlagEnabled('PROMPT_DUMP_DEBUG');
const ATTACHMENTS_DEBUG_ENABLED = isDebugFlagEnabled('ATTACHMENTS_DEBUG');

export const replyAction = {
  name: 'REPLY',
  similes: ['GREET', 'REPLY_TO_MESSAGE', 'SEND_REPLY', 'RESPOND', 'RESPONSE'],
  description:
    'Replies to the current conversation with the text from the generated message. Default if the agent is responding with a message and no other action. Use REPLY at the beginning of a chain of actions as an acknowledgement, and at the end of a chain of actions as a final response.',
  validate: async (_runtime: IAgentRuntime) => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: any,
    callback: HandlerCallback,
    responses?: Memory[]
  ): Promise<ActionResult> => {
    state = state ?? ({ values: {}, data: {}, text: '' } as State);
    state.values = state.values || {};
    state.data = state.data || {};
    state.text = typeof state.text === 'string' ? state.text : '';

    const actionContext = _options?.actionContext;
    const previousResults = actionContext?.previousResults || [];
    let corrId = ensureCorrelationId(state, message);

    if (previousResults.length > 0) {
      logger.debug(`[REPLY] Found ${previousResults.length} previous action results`);
    }

    const allProviders = responses?.flatMap((res) => res.content?.providers ?? []) ?? [];
    const providerSet = new Set<string>(['RECENT_MESSAGES', 'ACTION_STATE', 'RIP2ETF_SNAPSHOT']);
    if (!runtime.providers.some((p) => p.name === 'RIP2ETF_SNAPSHOT')) {
      providerSet.delete('RIP2ETF_SNAPSHOT');
      for (const providerName of allProviders) {
        providerSet.add(providerName);
      }
    }

    const providersList = Array.from(providerSet);
    if (PROMPT_DUMP_ENABLED) {
      logger.info(`reply:compose:start corrId=${corrId} providers=${JSON.stringify(providersList)}`);
    }

    state = await runtime.composeState(message, providersList);
    corrId = ensureCorrelationId(state, message, corrId);

    if (PROMPT_DUMP_ENABLED) {
      logger.info(`reply:providers:active corrId=${corrId} ${JSON.stringify(providersList)}`);
    }

    const previousValues = (state?.values || {}) as Record<string, unknown>;

    const snapshotProviderResult =
      state?.data?.providers?.RIP2ETF_SNAPSHOT ||
      state?.data?.providers?.rip2etf_snapshot ||
      null;

    const latestSnapshotResult = [...previousResults]
      .reverse()
      .find(
        (result) =>
          typeof result?.data?.actionName === 'string' &&
          result.data.actionName.toLowerCase() === 'rip2etf.snapshot'
      );

    let snapshotValues = (latestSnapshotResult?.values as Record<string, unknown>) || {};

    let snapshotSummary =
      (typeof state?.values?.snapshotSummary === 'string' && state.values.snapshotSummary) ||
      (typeof snapshotValues.snapshotSummary === 'string'
        ? (snapshotValues.snapshotSummary as string)
        : null);

    if (!snapshotSummary && shouldAutoTriggerSnapshot(message)) {
      const inlineValues = await maybeRunSnapshotAction(runtime, message, state, _options, responses);
      if (inlineValues) {
        snapshotValues = inlineValues;
        if (typeof inlineValues.snapshotSummary === 'string') {
          snapshotSummary = inlineValues.snapshotSummary as string;
          state.values.snapshotSummary = snapshotSummary;
        }
        if (typeof inlineValues.snapshotSummaryFull === 'string') {
          state.values.snapshotSummaryFull = inlineValues.snapshotSummaryFull;
        }
        if (Array.isArray(inlineValues.pendingAttachments)) {
          state.values.pendingAttachments = inlineValues.pendingAttachments as Media[];
        }
      }
    }

    if (snapshotSummary) {
      snapshotSummary = truncateByWords(snapshotSummary, SNAPSHOT_SUMMARY_WORD_LIMIT);
      state.values.snapshotSummary = snapshotSummary;
    }

    let limitedUserPrompt = '';
    let limitedHistory = '';

    if (snapshotProviderResult?.text && snapshotSummary) {
      const userPromptRaw =
        typeof message?.content?.text === 'string' ? message.content.text.trim() : '';
      limitedUserPrompt = trimUserPrompt(userPromptRaw);
      const historyRaw =
        typeof previousValues.RECENT_MESSAGES === 'string'
          ? (previousValues.RECENT_MESSAGES as string)
          : '';
      limitedHistory = trimRecentHistory(historyRaw);

      const snapshotBlock = trimTail(snapshotProviderResult.text, SNAPSHOT_PROMPT_LIMIT);
      const limitedSnapshotBlock = truncateByWords(snapshotBlock, LLM_PROMPT_WORD_LIMIT);

      const compactProviders = [
        limitedUserPrompt ? `# Richiesta utente\n${limitedUserPrompt}` : '',
        limitedSnapshotBlock,
        limitedHistory ? `# Ultimi messaggi rilevanti\n${limitedHistory}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      state.values = {
        ...state.values,
        providers: compactProviders,
        snapshotSummary,
      };
      state.text = compactProviders;
      state.data = {
        ...state.data,
        providers: {
          RIP2ETF_SNAPSHOT: snapshotProviderResult,
        },
        snapshotSummaryFull: state.values.snapshotSummaryFull ?? snapshotSummary,
      };
    }

    const attachmentsQueue = Array.isArray(state?.values?.pendingAttachments)
      ? (state.values.pendingAttachments as Media[])
      : [];

    const attachmentsToSend = attachmentsQueue.length
      ? attachmentsQueue.map((attachment) => ({ ...attachment }))
      : [];

    if (state?.values) {
      state.values.pendingAttachments = [];
    }

    if (ATTACHMENTS_DEBUG_ENABLED) {
      logger.info(
        `reply:attachments:snapshot corrId=${corrId} pending_n=${attachmentsQueue.length} details=${JSON.stringify(
          attachmentsQueue.map(describeAttachmentForLog)
        )}`
      );
    }

    if (attachmentsToSend.length > 0) {
      logger.info(`reply:attachments:fastpath corrId=${corrId} n=${attachmentsToSend.length}`);

      const caption = appendSentinel(snapshotSummary || '', true, corrId);
      await callback({
        thought: 'Snapshot summary delivered without LLM',
        text: caption,
        attachments: attachmentsToSend,
        actions: ['REPLY'],
        corrId,
        responseMode: 'attachments_only',
      });

      if (state?.values) {
        state.values.pendingAttachments = [];
        delete state.values.snapshotSummary;
        delete state.values.snapshotSummaryFull;
        delete state.values.snapshotData;
      }

      logAttachmentFlush(corrId, attachmentsToSend.length);
      logAttachmentsCleared(corrId);

      return {
        text: 'Delivered snapshot attachments without LLM',
        values: {
          success: true,
          responded: true,
          attachmentsOnly: true,
          lastReplyTime: Date.now(),
        },
        data: {
          actionName: 'REPLY',
          responseMode: 'attachments_only',
        },
        success: true,
      };
    }

    let prompt = composePromptFromState({
      state,
      template: runtime.character.templates?.replyTemplate || replyTemplate,
    });

    const promptBudget = snapshotProviderResult?.text
      ? SNAPSHOT_PROMPT_BUDGET_TOKENS
      : DEFAULT_PROMPT_BUDGET_TOKENS;
    const trimmedPrompt = enforcePromptBudget(prompt, promptBudget);
    if (trimmedPrompt !== prompt && PROMPT_DUMP_ENABLED) {
      logger.info(
        `reply:prompt:trim corrId=${corrId} original_len=${prompt.length} trimmed_len=${trimmedPrompt.length} budget_tokens=${promptBudget}`
      );
    }
    prompt = trimmedPrompt;

    if (PROMPT_DUMP_ENABLED) {
      const summaryLength = snapshotSummary?.length ?? 0;
      const historyLength = limitedHistory.length;
      const userTextLength = limitedUserPrompt.length;
      const tokenEstimate = Math.ceil(prompt.length / 4);
      logger.info(
        `reply:prompt:final corrId=${corrId} user_text_len=${userTextLength} summary_compact_len=${summaryLength} history_len=${historyLength} token_estimate=${tokenEstimate}`
      );
      logger.info(
        `reply:prompt:preview corrId=${corrId} <<<START\n${sanitizeLogPreview(prompt, 1500)}\nEND>>>`
      );
    }

    const llmStart = Date.now();

    try {
      const response = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
      });
      const latencyMs = Date.now() - llmStart;
      logger.info(
        `reply:llm:ok corrId=${corrId} output_len=${response.length} model=${ModelType.TEXT_SMALL} latency_ms=${latencyMs}`
      );

      const parsedXml = parseKeyValueXml(response);

      const responseContent: Content = {
        thought: parsedXml?.thought || '',
        text: parsedXml?.message || '',
        actions: ['REPLY'],
        corrId,
        responseMode: 'normal',
      };

      responseContent.text = appendSentinel(responseContent.text || '', false, corrId);
      await callback(responseContent);

      if (state?.values) {
        state.values.pendingAttachments = [];
        delete state.values.snapshotSummary;
        delete state.values.snapshotSummaryFull;
        delete state.values.snapshotData;
      }

      logAttachmentsCleared(corrId);
      logger.info(`reply:done corrId=${corrId} result=success`);

      return {
        text: `Generated reply: ${responseContent.text}`,
        values: {
          success: true,
          responded: true,
          lastReply: responseContent.text,
          lastReplyTime: Date.now(),
          thoughtProcess: parsedXml?.thought,
        },
        data: {
          actionName: 'REPLY',
          response: responseContent,
          thought: parsedXml?.thought,
          messageGenerated: true,
        },
        success: true,
      };
    } catch (error) {
      const latencyMs = Date.now() - llmStart;
      logger.error(`reply:llm:error corrId=${corrId} latency_ms=${latencyMs} msg="${(error as Error).message}"`);

      if (snapshotSummary) {
        const fallbackContent: Content = {
          thought: 'Fallback rip2etf summary after LLM failure',
          text: appendSentinel(snapshotSummary, false, corrId),
          actions: ['REPLY'],
          corrId,
          responseMode: 'fallback',
        };

        await callback(fallbackContent);

        if (state?.values) {
          state.values.pendingAttachments = [];
          delete state.values.snapshotSummary;
          delete state.values.snapshotSummaryFull;
          delete state.values.snapshotData;
        }

        logAttachmentsCleared(corrId);
        logger.info(`reply:fallback:completed corrId=${corrId}`);
        logger.info(`reply:done corrId=${corrId} result=fallback`);

        return {
          text: 'Delivered snapshot summary via fallback handler',
          values: {
            success: true,
            responded: true,
            lastReply: snapshotSummary,
            lastReplyTime: Date.now(),
            fallbackUsed: true,
          },
          data: {
            actionName: 'REPLY',
            fallbackUsed: true,
          },
          success: true,
        };
      }

      logger.info(`reply:done corrId=${corrId} result=error`);

      return {
        text: 'Error generating reply',
        values: {
          success: false,
          responded: false,
          error: true,
        },
        data: {
          actionName: 'REPLY',
          error: error instanceof Error ? error.message : String(error),
        },
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },
  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Hello there!',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Hi! How can I help you today?',
          actions: ['REPLY'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: "What's your favorite color?",
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'I really like deep shades of blue. They remind me of the ocean and the night sky.',
          actions: ['REPLY'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Can you explain how neural networks work?',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Let me break that down for you in simple terms...',
          actions: ['REPLY'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Could you help me solve this math problem?',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "Of course! Let's work through it step by step.",
          actions: ['REPLY'],
        },
      },
    ],
  ] as ActionExample[][],
} as Action;

function appendSentinel(text: string, includeSentinel: boolean, corrId: string): string {
  if (!includeSentinel) {
    return text || '';
  }
  const sentinel = `Vedi grafico allegato (PNG). corrId=${corrId}`;
  const base = text?.trim() ? text.trim() : '';
  if (base.includes(sentinel)) {
    return base;
  }
  return base ? `${base}\n\n${sentinel}` : sentinel;
}

function truncateByWords(text: string, maxWords: number): string {
  if (!text) return '';
  if (!Number.isFinite(maxWords) || maxWords <= 0) {
    return '';
  }

  let words = 0;
  let endIndex = text.length;
  const wordRegex = /\S+/g;
  let match: RegExpExecArray | null;

  while ((match = wordRegex.exec(text)) !== null) {
    words++;
    if (words === maxWords) {
      endIndex = match.index + match[0].length;
      break;
    }
  }

  if (words < maxWords) {
    return text;
  }

  return `${text.slice(0, endIndex)} …`;
}

function trimTail(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) {
    return text;
  }

  return text.slice(text.length - maxLength);
}

function trimUserPrompt(text: string): string {
  if (!text) return '';
  return text.length <= USER_PROMPT_CHAR_LIMIT ? text : text.slice(0, USER_PROMPT_CHAR_LIMIT);
}

function trimRecentHistory(text: string): string {
  if (!text) return '';
  const segments = text.split(/\n\n+/).slice(-RECENT_HISTORY_SEGMENTS);
  const joined = segments.join('\n\n');
  return trimTail(joined, RECENT_HISTORY_CHAR_LIMIT);
}

function enforcePromptBudget(prompt: string, tokenBudget: number): string {
  if (!prompt) {
    return prompt;
  }
  const effectiveBudget = Math.max(tokenBudget || 0, 1);
  const charBudget = effectiveBudget * 4;
  if (prompt.length <= charBudget) {
    return prompt;
  }
  return prompt.slice(prompt.length - charBudget);
}

function shouldAutoTriggerSnapshot(message: Memory): boolean {
  const text = typeof message?.content?.text === 'string' ? message.content.text : '';
  if (!text) {
    return false;
  }
  if (SNAPSHOT_HINT_REGEX.test(text)) {
    return true;
  }
  const tickerMatches = text.match(/[A-Z]{2,6}(?:\.[A-Z]{1,3})?/g);
  return Boolean(tickerMatches && tickerMatches.some((token) => token.length >= 3));
}

async function maybeRunSnapshotAction(
  runtime: IAgentRuntime,
  message: Memory,
  state: State,
  options: any,
  responses?: Memory[]
): Promise<Record<string, unknown> | null> {
  const snapshotAction = runtime.actions?.find(
    (action) => action.name?.toLowerCase() === 'rip2etf.snapshot'
  );
  if (!snapshotAction) {
    logger.warn('[REPLY] rip2etf.snapshot action not available in runtime');
    return null;
  }

  try {
    const result = await snapshotAction.handler(runtime, message, state, options, undefined, responses);
    if (result?.values && typeof result.values === 'object') {
      return result.values as Record<string, unknown>;
    }
  } catch (error) {
    logger.warn({ error }, '[REPLY] Inline snapshot execution failed');
  }

  return null;
}

function describeAttachmentForLog(attachment: Media) {
  const metrics = extractAttachmentMetricsForLog(attachment);
  return {
    type: attachment.contentType ?? 'unknown',
    mime: attachment.mimeType ?? attachment.contentType ?? 'unknown',
    filename: attachment.filename ?? attachment.title ?? attachment.id,
    bytes: metrics.bytes ?? null,
    sha1: metrics.sha1 ?? null,
  };
}

function extractAttachmentMetricsForLog(attachment: Media): { bytes?: number; sha1?: string } {
  const buffer = resolveAttachmentBufferForLog(attachment);
  if (!buffer) {
    return {};
  }
  return {
    bytes: buffer.length,
    sha1: createHash('sha1').update(buffer).digest('hex').slice(0, 8),
  };
}

function resolveAttachmentBufferForLog(attachment: Media): Buffer | null {
  if (Buffer.isBuffer(attachment.data)) {
    return attachment.data;
  }

  if (typeof attachment.data === 'string') {
    if (attachment.data.startsWith('data:')) {
      const base64 = attachment.data.split(',')[1] ?? '';
      return Buffer.from(base64, 'base64');
    }
    try {
      return Buffer.from(attachment.data, 'base64');
    } catch (error) {
      return null;
    }
  }

  if (typeof attachment.url === 'string' && attachment.url.startsWith('data:')) {
    const base64 = attachment.url.split(',')[1] ?? '';
    return Buffer.from(base64, 'base64');
  }

  return null;
}

function logAttachmentFlush(corrId: string, count: number) {
  if (ATTACHMENTS_DEBUG_ENABLED) {
    logger.info(`reply:attachments:flush corrId=${corrId} sent_n=${count}`);
  }
}

function logAttachmentsCleared(corrId: string) {
  if (ATTACHMENTS_DEBUG_ENABLED) {
    logger.info(`reply:attachments:cleared corrId=${corrId} pending_n=0`);
  }
}
