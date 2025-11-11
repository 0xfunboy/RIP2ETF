import { logger, type IAgentRuntime } from "@elizaos/core";
import {
  getApiKey,
  getAuthHeader,
  getBaseURL,
  isBrowser,
} from "./utils/config";

/**
 * Initialize and validate OpenAI configuration
 */
export function initializeOpenAI(_config: any, runtime: IAgentRuntime) {
  // Run validation in the background without blocking initialization
  void (async () => {
    try {
      if (!getApiKey(runtime) && !isBrowser()) {
        logger.warn(
          "OPENAI_API_KEY is not set in environment - OpenAI functionality will be limited",
        );
        return;
      }
      try {
        const baseURL = getBaseURL(runtime);
        const response = await fetch(`${baseURL}/models`, {
          headers: getAuthHeader(runtime),
        });
        if (!response.ok) {
          logger.warn(
            `OpenAI API key validation failed: ${response.statusText}`,
          );
          logger.warn(
            "OpenAI functionality will be limited until a valid API key is provided",
          );
        } else {
          logger.log("OpenAI API key validated successfully");
        }
      } catch (fetchError: unknown) {
        const message =
          fetchError instanceof Error ? fetchError.message : String(fetchError);
        logger.warn(`Error validating OpenAI API key: ${message}`);
        logger.warn(
          "OpenAI functionality will be limited until a valid API key is provided",
        );
      }
    } catch (error: unknown) {
      const message =
        (error as { errors?: Array<{ message: string }> })?.errors
          ?.map((e) => e.message)
          .join(", ") ||
        (error instanceof Error ? error.message : String(error));
      logger.warn(
        `OpenAI plugin configuration issue: ${message} - You need to configure the OPENAI_API_KEY in your environment variables`,
      );
    }
  })();
}
