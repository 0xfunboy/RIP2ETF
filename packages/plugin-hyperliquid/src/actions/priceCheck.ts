import {
  type Action,
  type ActionExample,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  logger,
  ModelType,
  parseKeyValueXml,
} from "@elizaos/core";
import { Hyperliquid } from "hyperliquid";
import { HyperliquidError } from "../types.js";
import { priceCheckTemplate } from "../templates.js";

export const priceCheck: Action = {
  name: "PRICE_CHECK",
  similes: ["CHECK_PRICE", "GET_PRICE", "PRICE", "CURRENT_PRICE"],
  description: "Get current price for a token on Hyperliquid",
  validate: async () => true, // Public endpoint
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    _options: Record<string, unknown> | undefined,
    callback?: HandlerCallback
  ) => {
    try {
      // Initialize or update state
      const currentState = state || (await runtime.composeState(message));

      const contextPrompt = priceCheckTemplate.replace(
        "{{recentMessages}}",
        currentState.recentMessagesString || ""
      );

      const result = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt: contextPrompt,
      });

      // Parse XML response
      const parsedContent = parseKeyValueXml(result);

      if (!parsedContent || !parsedContent.symbol) {
        throw new HyperliquidError(
          "Could not determine which token price to check"
        );
      }

      logger.info("Checking price for token:", parsedContent.symbol);

      // Initialize SDK
      const sdk = new Hyperliquid({
        enableWs: false,
      });
      await sdk.connect();

      // Get market data
      const [meta, assetCtxs] = await sdk.info.spot.getSpotMetaAndAssetCtxs();

      // Find token and market
      const tokenIndex = meta.tokens.findIndex(
        (token) =>
          token.name.toUpperCase() === parsedContent.symbol.toUpperCase()
      );
      if (tokenIndex === -1) {
        throw new HyperliquidError(
          `Could not find token ${parsedContent.symbol}`
        );
      }

      const marketIndex = assetCtxs.findIndex(
        (ctx) => ctx.coin === `${parsedContent.symbol}-SPOT`
      );
      if (marketIndex === -1) {
        throw new HyperliquidError(
          `Could not find market for ${parsedContent.symbol}`
        );
      }

      const marketCtx = assetCtxs[marketIndex];
      if (!marketCtx || !marketCtx.midPx) {
        throw new HyperliquidError(
          `Could not get market price for ${parsedContent.symbol}`
        );
      }

      const price = Number(marketCtx.midPx);
      const dayChange = (
        ((price - Number(marketCtx.prevDayPx)) / Number(marketCtx.prevDayPx)) *
        100
      ).toFixed(2);
      const volume = Number(marketCtx.dayNtlVlm).toFixed(2);

      if (callback) {
        callback({
          text: `${parsedContent.symbol} price: ${price.toFixed(2)} USDC (24h change: ${dayChange}%, volume: ${volume} USDC)`,
          content: {
            symbol: parsedContent.symbol,
            price: price,
            dayChange: dayChange,
            volume: volume,
          },
        });
      }

      return true;
    } catch (error) {
      logger.error("Error checking price:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (callback) {
        callback({
          text: `Error checking price: ${errorMessage}`,
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
          text: "What's the current price of PIP?",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll check the current PIP price for you.",
          action: "PRICE_CHECK",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "PIP price: 19.73 USDC (24h change: -1.82%, volume: 1053445.75 USDC)",
        },
      },
    ],
  ],
};

export default priceCheck;
