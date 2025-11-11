import type {
  IAgentRuntime,
  ObjectGenerationParams,
  ModelTypeName,
} from "@elizaos/core";
import { logger, ModelType } from "@elizaos/core";
import { generateObject, type JSONValue } from "ai";
import { createOpenAIClient } from "../providers";
import { getSmallModel, getLargeModel } from "../utils/config";
import { emitModelUsageEvent } from "../utils/events";
import { getJsonRepairFunction } from "../utils/json";

/**
 * Helper function to generate objects using specified model type
 */
async function generateObjectByModelType(
  runtime: IAgentRuntime,
  params: ObjectGenerationParams,
  modelType: ModelTypeName,
  getModelFn: (runtime: IAgentRuntime) => string,
): Promise<JSONValue> {
  const openai = createOpenAIClient(runtime);
  const modelName = getModelFn(runtime);
  logger.log(`[OpenAI] Using ${modelType} model: ${modelName}`);
  const temperature = params.temperature ?? 0;
  const schemaPresent = !!params.schema;

  if (schemaPresent) {
    logger.warn(
      `Schema provided but ignored: OpenAI object generation currently uses output=no-schema. The schema parameter has no effect.`,
    );
  }

  try {
    const { object, usage } = await generateObject({
      model: openai.languageModel(modelName),
      output: "no-schema",
      prompt: params.prompt,
      temperature: temperature,
      experimental_repairText: getJsonRepairFunction(),
    });

    if (usage) {
      emitModelUsageEvent(runtime, modelType, params.prompt, usage);
    }
    return object;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[generateObject] Error: ${message}`);
    throw error;
  }
}

/**
 * OBJECT_SMALL model handler
 */
export async function handleObjectSmall(
  runtime: IAgentRuntime,
  params: ObjectGenerationParams,
): Promise<JSONValue> {
  return generateObjectByModelType(
    runtime,
    params,
    ModelType.OBJECT_SMALL,
    getSmallModel,
  );
}

/**
 * OBJECT_LARGE model handler
 */
export async function handleObjectLarge(
  runtime: IAgentRuntime,
  params: ObjectGenerationParams,
): Promise<JSONValue> {
  return generateObjectByModelType(
    runtime,
    params,
    ModelType.OBJECT_LARGE,
    getLargeModel,
  );
}
