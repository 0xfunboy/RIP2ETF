import { describe, it, expect, beforeEach, jest, mock } from "bun:test";
import { priceCheck } from "../../actions/priceCheck";
import {
  createMockRuntime,
  createMockMemory,
  createMockState,
  createMockCallback,
  mockHyperliquidSdk,
} from "../test-utils";

// Mock the Hyperliquid module
mock.module("hyperliquid", () => ({
  Hyperliquid: jest.fn().mockImplementation(() => mockHyperliquidSdk),
}));

describe("priceCheck Action", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("validation", () => {
    it("should always validate since it's a public endpoint", async () => {
      const runtime = createMockRuntime({});
      const result = await priceCheck.validate(runtime, {} as any, {} as any);
      expect(result).toBe(true);
    });
  });

  describe("handler", () => {
    it("should check price successfully for HYPE", async () => {
      const runtime = createMockRuntime({});

      runtime.useModel = jest.fn().mockResolvedValue(
        `<response>
          <symbol>HYPE</symbol>
        </response>`
      );

      const memory = createMockMemory("What's the current price of HYPE?");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await priceCheck.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(true);
      expect(callback).toHaveBeenCalledWith({
        text: "HYPE price: 20.50 USDC (24h change: 2.50%, volume: 1000000.00 USDC)",
        content: {
          symbol: "HYPE",
          price: 20.5,
          dayChange: "2.50",
          volume: "1000000.00",
        },
      });
    });

    it("should check price successfully for PIP", async () => {
      const runtime = createMockRuntime({});

      runtime.useModel = jest.fn().mockResolvedValue(
        `<response>
          <symbol>PIP</symbol>
        </response>`
      );

      const memory = createMockMemory("What's the current price of PIP?");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await priceCheck.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(true);
      expect(callback).toHaveBeenCalledWith({
        text: "PIP price: 19.73 USDC (24h change: -1.84%, volume: 1053445.75 USDC)",
        content: {
          symbol: "PIP",
          price: 19.73,
          dayChange: "-1.84",
          volume: "1053445.75",
        },
      });
    });

    it("should handle parsing errors", async () => {
      const runtime = createMockRuntime({});

      runtime.useModel = jest.fn().mockResolvedValue("");

      const memory = createMockMemory("Check price");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await priceCheck.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(false);
      expect(callback).toHaveBeenCalledWith({
        text: expect.stringContaining(
          "Could not determine which token price to check"
        ),
        content: { error: expect.any(String) },
      });
    });

    it("should handle missing symbol in parsed result", async () => {
      const runtime = createMockRuntime({});

      runtime.useModel = jest.fn().mockResolvedValue(
        `<response>
          <!-- Missing symbol -->
        </response>`
      );

      const memory = createMockMemory("Check price");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await priceCheck.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(false);
      expect(callback).toHaveBeenCalledWith({
        text: expect.stringContaining(
          "Could not determine which token price to check"
        ),
        content: { error: expect.any(String) },
      });
    });

    it("should handle token not found", async () => {
      const runtime = createMockRuntime({});

      runtime.useModel = jest.fn().mockResolvedValue(
        `<response>
          <symbol>INVALID</symbol>
        </response>`
      );

      const memory = createMockMemory("What's the price of INVALID?");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await priceCheck.handler(
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

    it("should handle market not found", async () => {
      const runtime = createMockRuntime({});

      runtime.useModel = jest.fn().mockResolvedValue(
        `<response>
          <symbol>ETH</symbol>
        </response>`
      );

      // Mock market not found
      mockHyperliquidSdk.info.spot.getSpotMetaAndAssetCtxs.mockResolvedValueOnce(
        [
          {
            tokens: [{ name: "ETH", szDecimals: 4 }],
          },
          [], // No market contexts
        ]
      );

      const memory = createMockMemory("What's the price of ETH?");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await priceCheck.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(false);
      expect(callback).toHaveBeenCalledWith({
        text: expect.stringContaining("Could not find market for ETH"),
        content: { error: expect.any(String) },
      });
    });

    it("should handle missing market price", async () => {
      const runtime = createMockRuntime({});

      runtime.useModel = jest.fn().mockResolvedValue(
        `<response>
          <symbol>ETH</symbol>
        </response>`
      );

      // Mock market without price
      mockHyperliquidSdk.info.spot.getSpotMetaAndAssetCtxs.mockResolvedValueOnce(
        [
          {
            tokens: [{ name: "ETH", szDecimals: 4 }],
          },
          [
            {
              coin: "ETH-SPOT",
              midPx: null, // No price
              prevDayPx: "3400.00",
              dayNtlVlm: "50000000",
            },
          ],
        ]
      );

      const memory = createMockMemory("What's the price of ETH?");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await priceCheck.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(false);
      expect(callback).toHaveBeenCalledWith({
        text: expect.stringContaining("Could not get market price for ETH"),
        content: { error: expect.any(String) },
      });
    });

    it("should work without state parameter", async () => {
      const runtime = createMockRuntime({});

      runtime.useModel = jest.fn().mockResolvedValue(
        `<response>
          <symbol>HYPE</symbol>
        </response>`
      );

      const memory = createMockMemory("Check HYPE price");
      const callback = createMockCallback();

      const result = await priceCheck.handler(
        runtime,
        memory,
        null as any,
        {},
        callback
      );

      expect(result).toBe(true);
      expect(runtime.composeState).toHaveBeenCalledWith(memory);
    });

    it("should handle SDK connection errors", async () => {
      const runtime = createMockRuntime({});

      runtime.useModel = jest.fn().mockResolvedValue(
        `<response>
          <symbol>HYPE</symbol>
        </response>`
      );

      // Mock connection error
      mockHyperliquidSdk.connect.mockRejectedValueOnce(
        new Error("Connection failed")
      );

      const memory = createMockMemory("Check HYPE price");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await priceCheck.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(false);
      expect(callback).toHaveBeenCalledWith({
        text: expect.stringContaining("Error checking price"),
        content: { error: expect.any(String) },
      });
    });
  });

  describe("metadata", () => {
    it("should have correct name and similes", () => {
      expect(priceCheck.name).toBe("PRICE_CHECK");
      expect(priceCheck.similes).toContain("CHECK_PRICE");
      expect(priceCheck.similes).toContain("GET_PRICE");
      expect(priceCheck.similes).toContain("PRICE");
      expect(priceCheck.similes).toContain("CURRENT_PRICE");
    });

    it("should have proper examples", () => {
      expect(priceCheck.examples).toBeDefined();
      expect(priceCheck.examples?.length).toBeGreaterThan(0);
      expect(priceCheck.examples?.[0]).toBeInstanceOf(Array);
    });
  });
});
