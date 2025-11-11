import type { IAgentRuntime, ModelTypeName } from "@elizaos/core";
import { EventType } from "@elizaos/core";
import type { LanguageModelUsage } from "ai";

/**
 * Emits a model usage event
 * @param runtime The runtime context
 * @param type The model type
 * @param prompt The prompt used
 * @param usage The LLM usage data
 */
export function emitModelUsageEvent(
  runtime: IAgentRuntime,
  type: ModelTypeName,
  prompt: string,
  usage: LanguageModelUsage,
) {
  const promptTokens =
    ("promptTokens" in usage
      ? (usage as { promptTokens?: number }).promptTokens
      : undefined) ??
    ("inputTokens" in usage
      ? (usage as { inputTokens?: number }).inputTokens
      : undefined) ??
    0;
  const completionTokens =
    ("completionTokens" in usage
      ? (usage as { completionTokens?: number }).completionTokens
      : undefined) ??
    ("outputTokens" in usage
      ? (usage as { outputTokens?: number }).outputTokens
      : undefined) ??
    0;
  const totalTokens =
    ("totalTokens" in usage
      ? (usage as { totalTokens?: number }).totalTokens
      : undefined) ?? promptTokens + completionTokens;

  runtime.emitEvent(EventType.MODEL_USED, {
    provider: "openai",
    type,
    prompt,
    tokens: {
      prompt: promptTokens,
      completion: completionTokens,
      total: totalTokens,
    },
  });
}
