import { describe, it, expect, beforeEach, jest, mock } from "bun:test";
import { cancelOrders } from "../../actions/cancelOrders";
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

describe("cancelOrders Action", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("validation", () => {
    it("should validate when HYPERLIQUID_PRIVATE_KEY is set", async () => {
      const runtime = createMockRuntime({
        HYPERLIQUID_PRIVATE_KEY: "test-private-key",
      });
      const result = await cancelOrders.validate(runtime, {} as any, {} as any);
      expect(result).toBe(true);
    });

    it("should not validate when HYPERLIQUID_PRIVATE_KEY is missing", async () => {
      const runtime = createMockRuntime({});
      const result = await cancelOrders.validate(runtime, {} as any, {} as any);
      expect(result).toBe(false);
    });
  });

  describe("handler", () => {
    it("should cancel multiple orders successfully", async () => {
      const runtime = createMockRuntime({
        HYPERLIQUID_PRIVATE_KEY: "test-private-key",
        HYPERLIQUID_TESTNET: "false",
      });

      const memory = createMockMemory("Cancel all my orders");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await cancelOrders.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(true);
      expect(mockHyperliquidSdk.custom.cancelAllOrders).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith({
        text: "Successfully cancelled 2 open orders",
        content: expect.any(Object),
      });
    });

    it("should handle single order cancellation", async () => {
      const runtime = createMockRuntime({
        HYPERLIQUID_PRIVATE_KEY: "test-private-key",
      });

      // Mock single order response
      mockHyperliquidSdk.custom.cancelAllOrders.mockResolvedValueOnce({
        response: {
          data: {
            statuses: [{ orderId: "order1" }],
          },
        },
      });

      const memory = createMockMemory("Cancel all orders");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await cancelOrders.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(true);
      expect(callback).toHaveBeenCalledWith({
        text: "Successfully cancelled 1 open order",
        content: expect.any(Object),
      });
    });

    it("should handle no orders to cancel", async () => {
      const runtime = createMockRuntime({
        HYPERLIQUID_PRIVATE_KEY: "test-private-key",
      });

      // Mock empty response
      mockHyperliquidSdk.custom.cancelAllOrders.mockResolvedValueOnce({
        response: {
          data: {
            statuses: [],
          },
        },
      });

      const memory = createMockMemory("Cancel all orders");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await cancelOrders.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(true);
      expect(callback).toHaveBeenCalledWith({
        text: "No open orders to cancel",
        content: expect.any(Object),
      });
    });

    it("should handle null response data", async () => {
      const runtime = createMockRuntime({
        HYPERLIQUID_PRIVATE_KEY: "test-private-key",
      });

      // Mock null response
      mockHyperliquidSdk.custom.cancelAllOrders.mockResolvedValueOnce({
        response: null,
      });

      const memory = createMockMemory("Cancel all orders");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await cancelOrders.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(true);
      expect(callback).toHaveBeenCalledWith({
        text: "No open orders to cancel",
        content: expect.any(Object),
      });
    });

    it("should handle SDK errors gracefully", async () => {
      const runtime = createMockRuntime({
        HYPERLIQUID_PRIVATE_KEY: "test-private-key",
      });

      // Mock SDK error
      mockHyperliquidSdk.custom.cancelAllOrders.mockRejectedValueOnce(
        new Error("Network error")
      );

      const memory = createMockMemory("Cancel orders");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await cancelOrders.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(false);
      expect(callback).toHaveBeenCalledWith({
        text: "Error cancelling orders: Network error",
        content: { error: "Network error" },
      });
    });

    it("should handle testnet configuration", async () => {
      const runtime = createMockRuntime({
        HYPERLIQUID_PRIVATE_KEY: "test-private-key",
        HYPERLIQUID_TESTNET: "true",
      });

      const memory = createMockMemory("Cancel all orders");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await cancelOrders.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(true);
      // Test passes if handler succeeds with testnet configuration
    });

    it("should work without callback", async () => {
      const runtime = createMockRuntime({
        HYPERLIQUID_PRIVATE_KEY: "test-private-key",
      });

      const memory = createMockMemory("Cancel all orders");
      const state = createMockState();

      const result = await cancelOrders.handler(runtime, memory, state, {});

      expect(result).toBe(true);
      expect(mockHyperliquidSdk.custom.cancelAllOrders).toHaveBeenCalled();
    });

    it("should handle connection errors", async () => {
      const runtime = createMockRuntime({
        HYPERLIQUID_PRIVATE_KEY: "test-private-key",
      });

      // Mock connection error
      mockHyperliquidSdk.connect.mockRejectedValueOnce(
        new Error("Connection failed")
      );

      const memory = createMockMemory("Cancel orders");
      const state = createMockState();
      const callback = createMockCallback();

      const result = await cancelOrders.handler(
        runtime,
        memory,
        state,
        {},
        callback
      );

      expect(result).toBe(false);
      expect(callback).toHaveBeenCalledWith({
        text: expect.stringContaining("Error cancelling orders"),
        content: { error: expect.any(String) },
      });
    });
  });

  describe("metadata", () => {
    it("should have correct name and similes", () => {
      expect(cancelOrders.name).toBe("CANCEL_ORDERS");
      expect(cancelOrders.similes).toContain("CANCEL_ALL_ORDERS");
      expect(cancelOrders.similes).toContain("CANCEL");
      expect(cancelOrders.similes).toContain("CANCEL_ALL");
    });

    it("should have proper examples", () => {
      expect(cancelOrders.examples).toBeDefined();
      expect(cancelOrders.examples?.length).toBeGreaterThan(0);
      expect(cancelOrders.examples?.[0]).toBeInstanceOf(Array);
    });
  });
});
