import { logger } from "@elizaos/core";
import { JSONParseError } from "ai";

/**
 * Returns a function to repair JSON text
 */
export function getJsonRepairFunction(): (params: {
  text: string;
  error: unknown;
}) => Promise<string | null> {
  return async ({ text, error }: { text: string; error: unknown }) => {
    try {
      if (error instanceof JSONParseError) {
        const cleanedText = text.replace(/```json\n|\n```|```/g, "");
        JSON.parse(cleanedText);
        return cleanedText;
      }
      return null;
    } catch (jsonError: unknown) {
      const message =
        jsonError instanceof Error ? jsonError.message : String(jsonError);
      logger.warn(`Failed to repair JSON text: ${message}`);
      return null;
    }
  };
}
