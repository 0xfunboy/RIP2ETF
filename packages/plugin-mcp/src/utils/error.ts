import {
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  composePromptFromState,
  logger,
  type ActionResult,
} from '@elizaos/core';
import type { State } from '@elizaos/core';
import { errorAnalysisPrompt } from '../templates/errorAnalysisPrompt';
import type { McpProvider } from '../types';

export async function handleMcpError(
  state: State,
  mcpProvider: McpProvider,
  error: unknown,
  runtime: IAgentRuntime,
  message: Memory,
  type: 'tool' | 'resource',
  callback?: HandlerCallback
): Promise<ActionResult> {
  const errorMessage = error instanceof Error ? error.message : String(error);

  logger.error({ error, mcpType: type }, `Error executing MCP ${type}: ${errorMessage}`);

  let responseText = `I'm sorry, I wasn't able to get the information you requested. There seems to be an issue with the ${type} right now. Is there something else I can help you with?`;
  let thoughtText = `Error calling MCP ${type} and failed to generate a custom response. Providing a generic fallback response.`;

  if (callback) {
    const enhancedState: State = {
      ...state,
      values: {
        ...state.values,
        mcpProvider,
        userMessage: message.content.text || '',
        error: errorMessage,
      },
    };

    const prompt = composePromptFromState({
      state: enhancedState,
      template: errorAnalysisPrompt,
    });

    try {
      const errorResponse = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
      });

      responseText = errorResponse;
      thoughtText = `Error calling MCP ${type}: ${errorMessage}. Providing a helpful response to the user.`;

      await callback({
        thought: thoughtText,
        text: responseText,
        actions: ['REPLY'],
      });
    } catch (modelError) {
      logger.error(
        { error: modelError instanceof Error ? modelError.message : String(modelError) },
        'Failed to generate error response'
      );

      await callback({
        thought: thoughtText,
        text: responseText,
        actions: ['REPLY'],
      });
    }
  }

  return {
    text: `Failed to execute MCP ${type}`,
    values: {
      success: false,
      error: errorMessage,
      errorType: type,
    },
    data: {
      actionName: type === 'tool' ? 'CALL_MCP_TOOL' : 'READ_MCP_RESOURCE',
      error: errorMessage,
      mcpType: type,
    },
    success: false,
    error: error instanceof Error ? error : new Error(errorMessage),
  };
}

export class McpError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'UNKNOWN'
  ) {
    super(message);
    this.name = 'McpError';
  }

  static connectionError(serverName: string, details?: string): McpError {
    return new McpError(
      `Failed to connect to server '${serverName}'${details ? `: ${details}` : ''}`,
      'CONNECTION_ERROR'
    );
  }

  static toolNotFound(toolName: string, serverName: string): McpError {
    return new McpError(`Tool '${toolName}' not found on server '${serverName}'`, 'TOOL_NOT_FOUND');
  }

  static resourceNotFound(uri: string, serverName: string): McpError {
    return new McpError(
      `Resource '${uri}' not found on server '${serverName}'`,
      'RESOURCE_NOT_FOUND'
    );
  }

  static validationError(details: string): McpError {
    return new McpError(`Validation error: ${details}`, 'VALIDATION_ERROR');
  }

  static serverError(serverName: string, details?: string): McpError {
    return new McpError(
      `Server error from '${serverName}'${details ? `: ${details}` : ''}`,
      'SERVER_ERROR'
    );
  }
}
