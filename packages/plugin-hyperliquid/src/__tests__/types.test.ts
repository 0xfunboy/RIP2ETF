import { describe, it, expect } from "bun:test";
import { z } from "zod";
import {
  SpotOrderSchema,
  HyperliquidError,
  ORDER_STATUS,
  PRICE_VALIDATION,
} from "../types";

describe("Types and Schemas", () => {
  describe("SpotOrderSchema", () => {
    it("should validate a valid market order", () => {
      const validOrder = {
        coin: "HYPE",
        is_buy: true,
        sz: 1.5,
        limit_px: null,
        reduce_only: false,
      };

      const result = SpotOrderSchema.safeParse(validOrder);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        ...validOrder,
        order_type: { limit: { tif: "Gtc" } },
      });
    });

    it("should validate a valid limit order", () => {
      const validOrder = {
        coin: "ETH",
        is_buy: false,
        sz: 0.1,
        limit_px: 3500,
        reduce_only: true,
        order_type: { limit: { tif: "Ioc" } },
      };

      const result = SpotOrderSchema.safeParse(validOrder);
      expect(result.success).toBe(true);
    });

    it("should reject order with empty coin", () => {
      const invalidOrder = {
        coin: "",
        is_buy: true,
        sz: 1,
        limit_px: null,
      };

      const result = SpotOrderSchema.safeParse(invalidOrder);
      expect(result.success).toBe(false);
    });

    it("should reject order with negative size", () => {
      const invalidOrder = {
        coin: "HYPE",
        is_buy: true,
        sz: -1,
        limit_px: null,
      };

      const result = SpotOrderSchema.safeParse(invalidOrder);
      expect(result.success).toBe(false);
    });

    it("should reject order with zero size", () => {
      const invalidOrder = {
        coin: "HYPE",
        is_buy: true,
        sz: 0,
        limit_px: null,
      };

      const result = SpotOrderSchema.safeParse(invalidOrder);
      expect(result.success).toBe(false);
    });

    it("should reject order with negative limit price", () => {
      const invalidOrder = {
        coin: "HYPE",
        is_buy: true,
        sz: 1,
        limit_px: -10,
      };

      const result = SpotOrderSchema.safeParse(invalidOrder);
      expect(result.success).toBe(false);
    });

    it("should set default values correctly", () => {
      const minimalOrder = {
        coin: "HYPE",
        is_buy: true,
        sz: 1,
        limit_px: 20,
      };

      const result = SpotOrderSchema.parse(minimalOrder);
      expect(result.reduce_only).toBe(false);
      expect(result.order_type).toEqual({ limit: { tif: "Gtc" } });
    });
  });

  describe("HyperliquidError", () => {
    it("should create error with message only", () => {
      const error = new HyperliquidError("Test error");
      expect(error.message).toBe("Test error");
      expect(error.name).toBe("HyperliquidError");
      expect(error.code).toBeUndefined();
      expect(error.details).toBeUndefined();
    });

    it("should create error with code and details", () => {
      const details = { field: "value" };
      const error = new HyperliquidError("Test error", 400, details);
      expect(error.message).toBe("Test error");
      expect(error.code).toBe(400);
      expect(error.details).toEqual(details);
    });

    it("should be instanceof Error", () => {
      const error = new HyperliquidError("Test");
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("Constants", () => {
    it("should have correct ORDER_STATUS values", () => {
      expect(ORDER_STATUS.OPEN).toBe("open");
      expect(ORDER_STATUS.FILLED).toBe("filled");
      expect(ORDER_STATUS.CANCELLED).toBe("cancelled");
      expect(ORDER_STATUS.REJECTED).toBe("rejected");
    });

    it("should have correct PRICE_VALIDATION values", () => {
      expect(PRICE_VALIDATION.MARKET_ORDER.MIN_RATIO).toBe(0.5);
      expect(PRICE_VALIDATION.MARKET_ORDER.MAX_RATIO).toBe(1.5);
      expect(PRICE_VALIDATION.LIMIT_ORDER.WARNING_MIN_RATIO).toBe(0.2);
      expect(PRICE_VALIDATION.LIMIT_ORDER.WARNING_MAX_RATIO).toBe(5);
      expect(PRICE_VALIDATION.SLIPPAGE).toBe(0.01);
    });
  });

  describe("Type exports", () => {
    it("should export SpotOrder type", () => {
      // This is a compile-time check, but we can test basic structure
      const order: z.infer<typeof SpotOrderSchema> = {
        coin: "HYPE",
        is_buy: true,
        sz: 1,
        limit_px: null,
        reduce_only: false,
        order_type: { limit: { tif: "Gtc" } },
      };
      expect(order).toBeDefined();
    });
  });
});
