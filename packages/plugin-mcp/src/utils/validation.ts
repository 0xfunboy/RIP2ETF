import type { State } from "@elizaos/core";
import {
  type McpProviderData,
  type McpServer,
  ResourceSelectionSchema,
  type ValidationResult,
} from "../types";
import { validateJsonSchema } from "./json";
import {
  toolSelectionArgumentSchema,
  toolSelectionNameSchema,
  type ToolSelectionArgument,
  type ToolSelectionName,
} from "./schemas";

export interface ToolSelection {
  serverName: string;
  toolName: string;
  arguments: Record<string, unknown>;
  reasoning?: string;
  noToolAvailable?: boolean;
}

export interface ResourceSelection {
  serverName: string;
  uri: string;
  reasoning?: string;
  noResourceAvailable?: boolean;
}

export function validateToolSelectionName(
  parsed: unknown,
  state: State
): ValidationResult<ToolSelectionName> {
  const basicResult = validateJsonSchema<ToolSelectionName>(parsed, toolSelectionNameSchema);
  if (basicResult.success === false) {
    return { success: false, error: basicResult.error };
  }

  const data = basicResult.data;

  const mcpData = state.values.mcp || {};

  const server: McpServer | null = mcpData[data.serverName];
  if (!server || server.status !== "connected") {
    return {
      success: false,
      error: `Server "${data.serverName}" not found or not connected`,
    };
  }

  const toolInfo = server.tools?.[data.toolName as keyof McpServer["tools"]];
  if (!toolInfo) {
    return {
      success: false,
      error: `Tool "${data.toolName}" not found on server "${data.serverName}"`,
    };
  }

  return { success: true, data };
}

/**
 * Validates the tool selection argument object.
 * @param parsed - The tool selection object to validate
 * @param toolInputSchema - The input schema for the tool
 * @returns An object indicating success or failure of validation
 */
export function validateToolSelectionArgument(
  parsed: unknown,
  toolInputSchema: Record<string, unknown>
): ValidationResult<ToolSelectionArgument> {
  const basicResult = validateJsonSchema<ToolSelectionArgument>(
    parsed,
    toolSelectionArgumentSchema
  );
  if (basicResult.success === false) {
    return { success: false, error: basicResult.error };
  }

  const data = basicResult.data;
  const validationResult = validateJsonSchema(data.toolArguments, toolInputSchema);

  if (validationResult.success === false) {
    return {
      success: false,
      error: `Invalid arguments: ${validationResult.error}`,
    };
  }

  return { success: true, data };
}

export function validateResourceSelection(
  selection: unknown
): { success: true; data: ResourceSelection } | { success: false; error: string } {
  return validateJsonSchema<ResourceSelection>(selection, ResourceSelectionSchema);
}

export function createToolSelectionFeedbackPrompt(
  originalResponse: string,
  errorMessage: string,
  composedState: State,
  userMessage: string
): string {
  let toolsDescription = "";

  for (const [serverName, server] of Object.entries(composedState.values.mcp || {}) as [
    string,
    McpProviderData[string],
  ][]) {
    if (server.status !== "connected") continue;

    for (const [toolName, tool] of Object.entries(server.tools || {}) as [
      string,
      { description?: string },
    ][]) {
      toolsDescription += `Tool: ${toolName} (Server: ${serverName})\n`;
      toolsDescription += `Description: ${tool.description || "No description available"}\n\n`;
    }
  }

  return createFeedbackPrompt(
    originalResponse,
    errorMessage,
    "tool",
    toolsDescription,
    userMessage
  );
}

export function createResourceSelectionFeedbackPrompt(
  originalResponse: string,
  errorMessage: string,
  composedState: State,
  userMessage: string
): string {
  let resourcesDescription = "";

  for (const [serverName, server] of Object.entries(composedState.values.mcp || {}) as [
    string,
    McpProviderData[string],
  ][]) {
    if (server.status !== "connected") continue;

    for (const [uri, resource] of Object.entries(server.resources || {}) as [
      string,
      { description?: string; name?: string },
    ][]) {
      resourcesDescription += `Resource: ${uri} (Server: ${serverName})\n`;
      resourcesDescription += `Name: ${resource.name || "No name available"}\n`;
      resourcesDescription += `Description: ${
        resource.description || "No description available"
      }\n\n`;
    }
  }

  return createFeedbackPrompt(
    originalResponse,
    errorMessage,
    "resource",
    resourcesDescription,
    userMessage
  );
}

function createFeedbackPrompt(
  originalResponse: string,
  errorMessage: string,
  itemType: string,
  itemsDescription: string,
  userMessage: string
): string {
  return `Error parsing JSON: ${errorMessage}

Your original response:
${originalResponse}

Please try again with valid JSON for ${itemType} selection.
Available ${itemType}s:
${itemsDescription}

User request: ${userMessage}`;
}
