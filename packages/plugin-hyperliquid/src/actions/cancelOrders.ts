import {
  type Action,
  type ActionExample,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  logger,
} from "@elizaos/core";
import { Hyperliquid } from "hyperliquid";

export const cancelOrders: Action = {
  name: "CANCEL_ORDERS",
  similes: ["CANCEL_ALL_ORDERS", "CANCEL", "CANCEL_ALL"],
  description: "Cancel all open orders on Hyperliquid",
  validate: async (runtime: IAgentRuntime) => {
    return !!runtime.getSetting("HYPERLIQUID_PRIVATE_KEY");
  },
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown> | undefined,
    callback?: HandlerCallback
  ) => {
    try {
      // Initialize SDK
      const sdk = new Hyperliquid({
        privateKey: runtime.getSetting("HYPERLIQUID_PRIVATE_KEY"),
        testnet: runtime.getSetting("HYPERLIQUID_TESTNET") === "true",
        enableWs: false,
      });
      await sdk.connect();

      logger.info("Cancelling all open orders...");
      const result = await sdk.custom.cancelAllOrders();
      logger.info("Cancel result:", result);

      if (callback) {
        const cancelledCount = result?.response?.data?.statuses?.length || 0;
        callback({
          text:
            cancelledCount > 0
              ? `Successfully cancelled ${cancelledCount} open order${cancelledCount > 1 ? "s" : ""}`
              : "No open orders to cancel",
          content: result,
        });
      }

      return true;
    } catch (error) {
      logger.error("Error cancelling orders:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (callback) {
        callback({
          text: `Error cancelling orders: ${errorMessage}`,
          content: { error: errorMessage },
        });
      }
      return false;
    }
  },
  examples: [
    [
      {
        name: "{{user1}}",
        content: {
          text: "Cancel all my orders",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll cancel all your open orders.",
          action: "CANCEL_ORDERS",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Successfully cancelled 2 open orders",
        },
      },
    ],
  ],
};

export default cancelOrders;
