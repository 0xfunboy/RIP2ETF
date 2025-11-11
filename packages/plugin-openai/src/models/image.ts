import type { IAgentRuntime, ImageDescriptionParams } from "@elizaos/core";
import { logger, ModelType } from "@elizaos/core";
import type {
  OpenAIImageDescriptionResult,
  OpenAIImageGenerationResult,
} from "../types";
import {
  getSetting,
  getBaseURL,
  getAuthHeader,
  getImageDescriptionModel,
} from "../utils/config";
import { emitModelUsageEvent } from "../utils/events";

/**
 * IMAGE generation model handler
 */
export async function handleImageGeneration(
  runtime: IAgentRuntime,
  params: {
    prompt: string;
    n?: number;
    size?: string;
  },
): Promise<OpenAIImageGenerationResult> {
  const n = params.n || 1;
  const size = params.size || "1024x1024";
  const prompt = params.prompt;
  const modelName = getSetting(
    runtime,
    "OPENAI_IMAGE_MODEL",
    "gpt-image-1",
  ) as string;
  logger.log(`[OpenAI] Using IMAGE model: ${modelName}`);

  const baseURL = getBaseURL(runtime);

  try {
    const response = await fetch(`${baseURL}/images/generations`, {
      method: "POST",
      headers: {
        ...getAuthHeader(runtime),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelName,
        prompt: prompt,
        n: n,
        size: size,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to generate image: ${response.statusText}`);
    }

    const data = await response.json();
    const typedData = data as { data: { url: string }[] };

    return typedData;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

/**
 * IMAGE_DESCRIPTION model handler
 */
export async function handleImageDescription(
  runtime: IAgentRuntime,
  params: ImageDescriptionParams | string,
): Promise<OpenAIImageDescriptionResult | string> {
  let imageUrl: string;
  let promptText: string | undefined;
  const modelName = getImageDescriptionModel(runtime);
  logger.log(`[OpenAI] Using IMAGE_DESCRIPTION model: ${modelName}`);
  const maxTokens = Number.parseInt(
    getSetting(runtime, "OPENAI_IMAGE_DESCRIPTION_MAX_TOKENS", "8192") ||
      "8192",
    10,
  );

  const DEFAULT_PROMPT =
    "Please analyze this image and provide a title and detailed description.";

  if (typeof params === "string") {
    imageUrl = params;
    promptText = DEFAULT_PROMPT;
  } else {
    imageUrl = params.imageUrl;
    promptText = params.prompt || DEFAULT_PROMPT;
  }

  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: promptText },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    },
  ];

  const baseURL = getBaseURL(runtime);

  try {
    const requestBody: Record<string, any> = {
      model: modelName,
      messages: messages,
      max_tokens: maxTokens,
    };

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(runtime),
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const result: unknown = await response.json();

    type OpenAIResponseType = {
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };

    const typedResult = result as OpenAIResponseType;
    const content = typedResult.choices?.[0]?.message?.content;

    if (typedResult.usage) {
      emitModelUsageEvent(
        runtime,
        ModelType.IMAGE_DESCRIPTION,
        typeof params === "string" ? params : params.prompt || "",
        {
          inputTokens: typedResult.usage.prompt_tokens,
          outputTokens: typedResult.usage.completion_tokens,
          totalTokens: typedResult.usage.total_tokens,
        },
      );
    }

    if (!content) {
      return {
        title: "Failed to analyze image",
        description: "No response from API",
      };
    }

    // Check if a custom prompt was provided
    const isCustomPrompt =
      typeof params === "object" &&
      Boolean(params.prompt) &&
      params.prompt !== DEFAULT_PROMPT;

    // If custom prompt is used, return the raw content
    if (isCustomPrompt) {
      return content;
    }

    // Otherwise, maintain backwards compatibility with object return
    const titleMatch = content.match(/title[:\s]+(.+?)(?:\n|$)/i);
    const title = titleMatch?.[1]?.trim();
    if (!title) {
      logger.warn("Could not extract title from image description response");
    }
    const finalTitle = title || "Image Analysis";
    const description = content.replace(/title[:\s]+(.+?)(?:\n|$)/i, "").trim();

    const processedResult = { title: finalTitle, description };
    return processedResult;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Error analyzing image: ${message}`);
    return {
      title: "Failed to analyze image",
      description: `Error: ${message}`,
    };
  }
}
