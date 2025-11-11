import type {
  GenerateTextParams,
  IAgentRuntime,
  ModelTypeName,
} from "@elizaos/core";
import { logger, ModelType } from "@elizaos/core";
import { generateText } from "ai";
import { createOpenAIClient } from "../providers";
import {
  getSmallModel,
  getLargeModel,
  getExperimentalTelemetry,
} from "../utils/config";
import { emitModelUsageEvent } from "../utils/events";

async function generateTextByModelType(
  runtime: IAgentRuntime,
  params: GenerateTextParams,
  modelType: ModelTypeName,
  getModelFn: (runtime: IAgentRuntime) => string,
): Promise<string> {
  const openai = createOpenAIClient(runtime);
  const modelName = getModelFn(runtime);
  const experimentalTelemetry = getExperimentalTelemetry(runtime);

  logger.log(`[OpenAI] Using ${modelType} model: ${modelName}`);
  logger.log(params.prompt);

  const {
    prompt,
    stopSequences,
    maxTokens,
    temperature,
    frequencyPenalty,
    presencePenalty,
  } = params;

  const request: Parameters<typeof generateText>[0] = {
    model: openai.languageModel(modelName),
    prompt,
    system: runtime.character.system ?? undefined,
    temperature: temperature ?? 0.7,
    maxOutputTokens: maxTokens ?? 8192,
    experimental_telemetry: {
      isEnabled: experimentalTelemetry,
    },
  };

  if (Array.isArray(stopSequences) && stopSequences.length > 0) {
    request.stopSequences = stopSequences;
  }

  if (typeof frequencyPenalty === 'number') {
    request.frequencyPenalty = frequencyPenalty;
  }

  if (typeof presencePenalty === 'number') {
    request.presencePenalty = presencePenalty;
  }

  const { text: openaiResponse, usage } = await generateText(request);

  if (usage) {
    emitModelUsageEvent(runtime, modelType, prompt, usage);
  }

  return openaiResponse;
}

/**
 * TEXT_SMALL model handler
 */
export async function handleTextSmall(
  runtime: IAgentRuntime,
  params: GenerateTextParams,
): Promise<string> {
  return generateTextByModelType(
    runtime,
    params,
    ModelType.TEXT_SMALL,
    getSmallModel,
  );
}

/**
 * TEXT_LARGE model handler
 */
export async function handleTextLarge(
  runtime: IAgentRuntime,
  params: GenerateTextParams,
): Promise<string> {
  return generateTextByModelType(
    runtime,
    params,
    ModelType.TEXT_LARGE,
    getLargeModel,
  );
}
