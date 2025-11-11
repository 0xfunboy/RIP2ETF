import type { HandlerCallback, ActionResult } from '@elizaos/core';

export async function handleNoToolAvailable(
  callback?: HandlerCallback,
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  toolSelection?: Record<string, any> | null
): Promise<ActionResult> {
  const responseText =
    "I don't have a specific tool that can help with that request. Let me try to assist you directly instead.";
  const thoughtText =
    'No appropriate MCP tool available for this request. Falling back to direct assistance.';

  if (callback && toolSelection?.noToolAvailable) {
    await callback({
      text: responseText,
      thought: thoughtText,
      actions: ['REPLY'],
    });
  }

  return {
    text: responseText,
    values: {
      success: true,
      noToolAvailable: true,
      fallbackToDirectAssistance: true,
    },
    data: {
      actionName: 'CALL_MCP_TOOL',
      noToolAvailable: true,
      reason: toolSelection?.reasoning || 'No appropriate tool available',
    },
    success: true,
  };
}
