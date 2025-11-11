import { describe, it, expect, beforeEach, jest, mock } from "bun:test";
import { spotTrade } from "../../actions/spotTrade";
import {
  createMockRuntime,
  createMockMemory,
  createMockState,
  createMockCallback,
  mockHyperliquidSdk,
} from "../test-utils";
import { HyperliquidError } from "../../types";

// Mock the Hyperliquid module
mock.module("hyperliquid", () => ({
  Hyperliquid: jest.fn().mockImplementation(() => mockHyperliquidSdk),
}));

describe("spotTrade Action", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("validation", () => {
    it("should validate when HYPERLIQUID_PRIVATE_KEY is set", async () => {
      const runtime = createMockRuntime({
        HYPERLIQUID_PRIVATE_KEY: "test-private-key",
      });
      const result = await spotTrade.validate(runtime, {} as any, {} as any);
      expect(result).toBe(true);
    });

    it("should not validate when HYPERLIQUID_PRIVATE_KEY is missing", async () => {
      const runtime = createMockRuntime({});
      const result = await spotTrade.validate(runtime, {} as any, {} as any);
      expect(result).toBe(false);
    });
  });

  describe("handler", () => {
    it("should place a market buy order successfully", async () => {
      const runtime = createMockRuntime({
        HYPERLIQUID_PRIVATE_KEY: "test-private-key",
        HYPERLIQUID_TESTNET: "false",
      });

      runtime.useModel = jest.fn().mockResolvedValue(
        `<response>
          <coin>HYPE</coin>
          <is_buy>true</is_buy>
          <sz>1</sz>
          <limit_px>null</limit_px>
        </response>`
      );

      const memory = createMockMemory("Buy 1 HYPE");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await spotTrade.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(true);
      expect(mockHyperliquidSdk.exchange.placeOrder).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith({
        text: expect.stringContaining(
          "Successfully placed a market order to buy 1 HYPE"
        ),
        content: expect.any(Object),
      });
    });

    it("should place a limit sell order successfully", async () => {
      const runtime = createMockRuntime({
        HYPERLIQUID_PRIVATE_KEY: "test-private-key",
        HYPERLIQUID_TESTNET: "false",
      });

      runtime.useModel = jest.fn().mockResolvedValue(
        `<response>
          <coin>HYPE</coin>
          <is_buy>false</is_buy>
          <sz>2</sz>
          <limit_px>21</limit_px>
        </response>`
      );

      const memory = createMockMemory("Sell 2 HYPE at 21 USDC");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await spotTrade.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(true);
      expect(mockHyperliquidSdk.exchange.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          coin: "HYPE-SPOT",
          is_buy: false,
          sz: 2,
          limit_px: 21,
          order_type: { limit: { tif: "Gtc" } },
        })
      );
      expect(callback).toHaveBeenCalledWith({
        text: expect.stringContaining(
          "Successfully placed a limit order to sell 2 HYPE"
        ),
        content: expect.any(Object),
      });
    });

    it("should handle parsing errors", async () => {
      const runtime = createMockRuntime({
        HYPERLIQUID_PRIVATE_KEY: "test-private-key",
      });

      runtime.useModel = jest.fn().mockResolvedValue("");

      const memory = createMockMemory("Invalid trade");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await spotTrade.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(false);
      expect(callback).toHaveBeenCalledWith({
        text: expect.stringContaining("Error placing spot order"),
        content: { error: expect.any(String) },
      });
    });

    it("should handle token not found errors", async () => {
      const runtime = createMockRuntime({
        HYPERLIQUID_PRIVATE_KEY: "test-private-key",
      });

      runtime.useModel = jest.fn().mockResolvedValue(
        `<response>
          <coin>INVALID</coin>
          <is_buy>true</is_buy>
          <sz>1</sz>
          <limit_px>null</limit_px>
        </response>`
      );

      const memory = createMockMemory("Buy 1 INVALID");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await spotTrade.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(false);
      expect(callback).toHaveBeenCalledWith({
        text: expect.stringContaining("Could not find token INVALID"),
        content: { error: expect.any(String) },
      });
    });

    it("should validate buy limit order price above market", async () => {
      const runtime = createMockRuntime({
        HYPERLIQUID_PRIVATE_KEY: "test-private-key",
      });

      runtime.useModel = jest.fn().mockResolvedValue(
        `<response>
          <coin>HYPE</coin>
          <is_buy>true</is_buy>
          <sz>1</sz>
          <limit_px>25</limit_px>
        </response>`
      );

      const memory = createMockMemory("Buy 1 HYPE at 25 USDC");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await spotTrade.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(false);
      expect(callback).toHaveBeenCalledWith({
        text: expect.stringContaining("Cannot place buy limit order"),
        content: { error: expect.any(String) },
      });
    });

    it("should validate sell limit order price below market", async () => {
      const runtime = createMockRuntime({
        HYPERLIQUID_PRIVATE_KEY: "test-private-key",
      });

      runtime.useModel = jest.fn().mockResolvedValue(
        `<response>
          <coin>HYPE</coin>
          <is_buy>false</is_buy>
          <sz>1</sz>
          <limit_px>18</limit_px>
        </response>`
      );

      const memory = createMockMemory("Sell 1 HYPE at 18 USDC");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await spotTrade.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(false);
      expect(callback).toHaveBeenCalledWith({
        text: expect.stringContaining("Cannot place sell limit order"),
        content: { error: expect.any(String) },
      });
    });

    it("should handle order rejection from exchange", async () => {
      const runtime = createMockRuntime({
        HYPERLIQUID_PRIVATE_KEY: "test-private-key",
      });

      runtime.useModel = jest.fn().mockResolvedValue(
        `<response>
          <coin>HYPE</coin>
          <is_buy>true</is_buy>
          <sz>1</sz>
          <limit_px>null</limit_px>
        </response>`
      );

      // Mock order rejection
      mockHyperliquidSdk.exchange.placeOrder.mockResolvedValueOnce({
        status: "ok",
        response: {
          type: "order",
          data: {
            statuses: [
              {
                error: "Insufficient balance",
              },
            ],
          },
        },
      });

      const memory = createMockMemory("Buy 1 HYPE");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await spotTrade.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(false);
      expect(callback).toHaveBeenCalledWith({
        text: expect.stringContaining("Insufficient balance"),
        content: { error: expect.any(String) },
      });
    });

    it("should work without state parameter", async () => {
      const runtime = createMockRuntime({
        HYPERLIQUID_PRIVATE_KEY: "test-private-key",
      });

      runtime.useModel = jest.fn().mockResolvedValue(
        `<response>
          <coin>HYPE</coin>
          <is_buy>true</is_buy>
          <sz>1</sz>
          <limit_px>null</limit_px>
        </response>`
      );

      const memory = createMockMemory("Buy 1 HYPE");
      const callback = createMockCallback();

      const result = await spotTrade.handler(
        runtime,
        memory,
        null as any,
        {},
        callback
      );

      expect(result).toBe(true);
      expect(runtime.composeState).toHaveBeenCalledWith(memory);
    });

    it("should handle testnet configuration", async () => {
      const runtime = createMockRuntime({
        HYPERLIQUID_PRIVATE_KEY: "test-private-key",
        HYPERLIQUID_TESTNET: "true",
      });

      runtime.useModel = jest.fn().mockResolvedValue(
        `<response>
          <coin>HYPE</coin>
          <is_buy>true</is_buy>
          <sz>1</sz>
          <limit_px>null</limit_px>
        </response>`
      );

      const memory = createMockMemory("Buy 1 HYPE");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await spotTrade.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(true);
      // Test passes if handler succeeds with testnet configuration
    });
  });

  describe("metadata", () => {
    it("should have correct name and similes", () => {
      expect(spotTrade.name).toBe("SPOT_TRADE");
      expect(spotTrade.similes).toContain("SPOT_ORDER");
      expect(spotTrade.similes).toContain("SPOT_BUY");
      expect(spotTrade.similes).toContain("SPOT_SELL");
    });

    it("should have proper examples", () => {
      expect(spotTrade.examples).toBeDefined();
      expect(spotTrade.examples?.length).toBeGreaterThan(0);
      expect(spotTrade.examples?.[0]).toBeInstanceOf(Array);
    });
  });
});
