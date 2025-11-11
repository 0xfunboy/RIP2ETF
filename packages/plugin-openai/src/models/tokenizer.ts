import type {
  IAgentRuntime,
  TokenizeTextParams,
  DetokenizeTextParams,
} from "@elizaos/core";
import { ModelType } from "@elizaos/core";
import { tokenizeText, detokenizeText } from "../utils/tokenization";

/**
 * TEXT_TOKENIZER_ENCODE model handler
 */
export async function handleTokenizerEncode(
  runtime: IAgentRuntime,
  { prompt, modelType = ModelType.TEXT_LARGE }: TokenizeTextParams,
): Promise<number[]> {
  return await tokenizeText(runtime, modelType, prompt);
}

/**
 * TEXT_TOKENIZER_DECODE model handler
 */
export async function handleTokenizerDecode(
  runtime: IAgentRuntime,
  { tokens, modelType = ModelType.TEXT_LARGE }: DetokenizeTextParams,
): Promise<string> {
  return await detokenizeText(runtime, modelType, tokens);
}
