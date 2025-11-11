import {
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  type State,
  composePromptFromState,
  logger,
} from "@elizaos/core";
import { withModelRetry } from "./wrapper";
import type { McpProvider, McpProviderData } from "../types";
import type { ToolSelectionName, ToolSelectionArgument } from "./schemas";
import {
  toolSelectionArgumentTemplate,
  toolSelectionNameTemplate,
} from "../templates/toolSelectionTemplate";
import { validateToolSelectionArgument, validateToolSelectionName } from "./validation";

export interface CreateToolSelectionOptions {
  runtime: IAgentRuntime;
  state: State;
  message: Memory;
  callback?: HandlerCallback;
  mcpProvider: McpProvider;
  toolSelectionName?: ToolSelectionName;
}

/**
 *  Creates a tool selection name based on the current state and MCP provider.
 * @returns A tool selection name object or null if the selection is invalid.
 * ```json
 * {
 *  "serverName": "github",
 *  "toolName": "get_file_contents",
 *  "reasoning": "The user wants to see the README from the facebook/react repository based on our conversation."
 *  "noToolSelection": false
 * }
 * ```
 */
export async function createToolSelectionName({
  runtime,
  state,
  message,
  callback,
  mcpProvider,
}: CreateToolSelectionOptions): Promise<ToolSelectionName | null> {
  const toolSelectionPrompt: string = composePromptFromState({
    state: { ...state, values: { ...state.values, mcpProvider } },
    template: toolSelectionNameTemplate,
  });
  logger.debug(`[SELECTION] Tool Selection Name Prompt:\n${toolSelectionPrompt}`);

  // Use the model to generate a tool selection stringified json response
  const toolSelectionName: string = await runtime.useModel(ModelType.TEXT_LARGE, {
    prompt: toolSelectionPrompt,
  });
  logger.debug(`[SELECTION] Tool Selection Name Response:\n${toolSelectionName}`);

  return await withModelRetry<ToolSelectionName>({
    runtime,
    message,
    state,
    callback,
    input: toolSelectionName,
    validationFn: (parsed) => validateToolSelectionName(parsed, state),
    createFeedbackPromptFn: (originalResponse, errorMessage, state, userMessage) =>
      createToolSelectionFeedbackPrompt(originalResponse, errorMessage, state, userMessage),
    failureMsg: "I'm having trouble figuring out the best way to help with your request.",
  });
}
/**
 * Creates a tool selection argument based on the current state and MCP provider.
 * @returns  A tool selection argument object or null if the selection is invalid.
 * ```json
 * {
 *  "toolArguments": {
 *    "file_path": "facebook/react/README.md",
 *    "repo": "facebook/react"
 *  },
 *  "reasoning": "The user wants to see the README from the facebook/react repository based on our conversation."
 * }
 */
export async function createToolSelectionArgument({
  runtime,
  state,
  message,
  callback,
  mcpProvider,
  toolSelectionName,
}: CreateToolSelectionOptions): Promise<ToolSelectionArgument | null> {
  if (!toolSelectionName) {
    logger.warn(
      "[SELECTION] Tool selection name is not provided. Cannot create tool selection argument."
    );
    return null;
  }
  const { serverName, toolName } = toolSelectionName;
  const toolInputSchema = mcpProvider.data.mcp[serverName].tools[toolName].inputSchema;
  logger.trace(`[SELECTION] Tool Input Schema:\n${JSON.stringify({ toolInputSchema }, null, 2)}`);

  // Create a tool selection argument prompt
  const toolSelectionArgumentPrompt: string = composePromptFromState({
    state: {
      ...state,
      values: {
        ...state.values,
        toolSelectionName,
        toolInputSchema: JSON.stringify(toolInputSchema),
      },
    },
    template: toolSelectionArgumentTemplate,
  });
  logger.debug(`[SELECTION] Tool Selection Prompt:\n${toolSelectionArgumentPrompt}`);

  // Use the model to generate a tool selection argument stringified json response
  const toolSelectionArgument: string = await runtime.useModel(ModelType.TEXT_LARGE, {
    prompt: toolSelectionArgumentPrompt,
  });
  logger.debug(`[SELECTION] Tool Selection Argument Response:\n${toolSelectionArgument}`);

  return await withModelRetry<ToolSelectionArgument>({
    runtime,
    message,
    state,
    callback,
    input: toolSelectionArgument,
    validationFn: (parsed) => validateToolSelectionArgument(parsed, state),
    createFeedbackPromptFn: (originalResponse, errorMessage, state, userMessage) =>
      createToolSelectionFeedbackPrompt(originalResponse, errorMessage, state, userMessage),
    failureMsg: "I'm having trouble figuring out the best way to help with your request.",
  });
}

function createToolSelectionFeedbackPrompt(
  originalResponse: string | object,
  errorMessage: string,
  state: State,
  userMessage: string
): string {
  let toolsDescription = "";

  for (const [serverName, server] of Object.entries(state.values.mcp || {}) as [
    string,
    McpProviderData[string],
  ][]) {
    if (server.status !== "connected") continue;

    for (const [toolName, tool] of Object.entries(server.tools || {})) {
      toolsDescription += `Tool: ${toolName} (Server: ${serverName})\n`;
      toolsDescription += `Description: ${tool.description || "No description available"}\n\n`;
    }
  }

  const feedbackPrompt = createFeedbackPrompt(
    originalResponse,
    errorMessage,
    "tool",
    toolsDescription,
    userMessage
  );
  logger.debug(`[SELECTION] Tool Selection Feedback Prompt:\n${feedbackPrompt}`);
  return feedbackPrompt;
}

function createFeedbackPrompt(
  originalResponse: string | object,
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
