import type { IAgentRuntime, ModelTypeName } from "@elizaos/core";
import { ModelType } from "@elizaos/core";
import { encodingForModel, getEncoding, type TiktokenModel, type TiktokenEncoding } from "js-tiktoken";
import { getLargeModel, getSmallModel } from "./config";

function resolveTokenizerEncoding(
  modelName: string,
): ReturnType<typeof encodingForModel> {
  const normalized = modelName.toLowerCase();
  const fallbackEncoding: TiktokenEncoding = normalized.includes("4o")
    ? "o200k_base"
    : "cl100k_base";

  try {
    return encodingForModel(modelName as TiktokenModel);
  } catch (error: unknown) {
    // Use getEncoding for the fallback encoding names
    return getEncoding(fallbackEncoding);
  }
}

/**
 * Asynchronously tokenizes the given text based on the specified model and prompt.
 *
 * @param {ModelTypeName} model - The type of model to use for tokenization.
 * @param {string} prompt - The text prompt to tokenize.
 * @returns {number[]} - An array of tokens representing the encoded prompt.
 */
export async function tokenizeText(
  runtime: IAgentRuntime,
  model: ModelTypeName,
  prompt: string,
) {
  const modelName =
    model === ModelType.TEXT_SMALL
      ? getSmallModel(runtime)
      : getLargeModel(runtime);
  const tokens = resolveTokenizerEncoding(modelName).encode(prompt);
  return tokens;
}

/**
 * Detokenize a sequence of tokens back into text using the specified model.
 *
 * @param {ModelTypeName} model - The type of model to use for detokenization.
 * @param {number[]} tokens - The sequence of tokens to detokenize.
 * @returns {string} The detokenized text.
 */
export async function detokenizeText(
  runtime: IAgentRuntime,
  model: ModelTypeName,
  tokens: number[],
) {
  const modelName =
    model === ModelType.TEXT_SMALL
      ? getSmallModel(runtime)
      : getLargeModel(runtime);
  return resolveTokenizerEncoding(modelName).decode(tokens);
}
