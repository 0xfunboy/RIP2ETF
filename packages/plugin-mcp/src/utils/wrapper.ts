import { parseJSON } from './json';

import {
  type HandlerCallback,
  type Memory,
  type IAgentRuntime,
  type State,
  logger,
  ModelType,
} from '@elizaos/core';
import { DEFAULT_MAX_RETRIES, type ValidationResult } from '../types';

export type Input = string | object;

type CreateFeedbackPromptFnOptions = (
  originalResponse: Input,
  errorMessage: string,
  composedState: State,
  userMessage: string
) => string;

export interface WithModelRetryOptions<T> {
  runtime: IAgentRuntime;
  message: Memory;
  state: State;
  input: Input;
  validationFn: (data: Input) => ValidationResult<T>;
  createFeedbackPromptFn: CreateFeedbackPromptFnOptions;
  callback?: HandlerCallback;
  failureMsg?: string;
  retryCount?: number;
}

/**
 * Retries the model selection process in case of parsing errors.
 * @param input - The initial input to be parsed
 * @param validationFn - The function to validate the parsed data
 * @param createFeedbackPromptFn - The function to create a feedback prompt
 * @param failureMsg - The message to be sent in case of failure
 * @param retryCount - The current retry count
 * @returns
 */
export async function withModelRetry<T>({
  runtime,
  message,
  state,
  callback,
  input,
  validationFn,
  createFeedbackPromptFn,
  failureMsg,
  retryCount = 0,
}: WithModelRetryOptions<T>): Promise<T | null> {
  const maxRetries = getMaxRetries(runtime);

  try {
    logger.info(`[WITH-MODEL-RETRY] Raw selection input:\n${input}`);

    // If it's a first retry, input is a string, so we need to parse it
    const parsedJson = typeof input === 'string' ? parseJSON<string>(input) : input;
    logger.debug(
      `[WITH-MODEL-RETRY] Parsed selection input:\n${JSON.stringify(parsedJson, null, 2)}`
    );

    const validationResult = validationFn(parsedJson);

    if (validationResult.success === false) {
      throw new Error(validationResult.error);
    }

    return validationResult.data as T;
  } catch (parseError) {
    const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown parsing error';

    logger.error({ errorMessage }, `[WITH-MODEL-RETRY] Failed to parse response: ${errorMessage}`);

    if (retryCount < maxRetries) {
      logger.debug(`[WITH-MODEL-RETRY] Retrying (attempt ${retryCount + 1}/${maxRetries})`);

      const feedbackPrompt: string = createFeedbackPromptFn(
        input,
        errorMessage,
        state,
        message.content.text || ''
      );

      const retrySelection: object = await runtime.useModel(ModelType.OBJECT_LARGE, {
        prompt: feedbackPrompt,
      });

      return withModelRetry({
        runtime,
        input: retrySelection,
        validationFn,
        message,
        state,
        createFeedbackPromptFn,
        callback,
        failureMsg,
        retryCount: retryCount + 1,
      });
    }

    if (callback && failureMsg) {
      await callback({
        text: failureMsg,
        thought:
          'Failed to parse response after multiple retries. Requesting clarification from user.',
        actions: ['REPLY'],
      });
    }
    return null;
  }
}

/**
 * Retrieves the maximum number of retries for MCP selection from the agent runtime settings.
 * @param runtime - The agent runtime
 * @returns The maximum number of retries for MCP selection
 */
function getMaxRetries(runtime: IAgentRuntime): number {
  try {
    const settings = runtime.getSetting('mcp');
    if (settings && 'maxRetries' in settings && settings.maxRetries !== undefined) {
      const configValue = Number(settings.maxRetries);
      if (!Number.isNaN(configValue) && configValue >= 0) {
        logger.debug(`[WITH-MODEL-RETRY] Using configured selection retries: ${configValue}`);
        return configValue;
      }
    }
  } catch (error) {
    logger.debug(
      { error: error instanceof Error ? error.message : String(error) },
      '[WITH-MODEL-RETRY] Error reading selection retries config'
    );
  }

  return DEFAULT_MAX_RETRIES;
}
