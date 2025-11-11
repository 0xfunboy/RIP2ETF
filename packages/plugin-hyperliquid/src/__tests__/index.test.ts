import { describe, it, expect } from "bun:test";
import { hyperliquidPlugin } from "../index";
import { spotTrade } from "../actions/spotTrade";
import { priceCheck } from "../actions/priceCheck";
import { cancelOrders } from "../actions/cancelOrders";

describe("Hyperliquid Plugin", () => {
  it("should have correct plugin metadata", () => {
    expect(hyperliquidPlugin.name).toBe("hyperliquid");
    expect(hyperliquidPlugin.description).toBe("Hyperliquid plugin");
  });

  it("should export all actions", () => {
    expect(hyperliquidPlugin.actions).toHaveLength(3);
    expect(hyperliquidPlugin.actions).toContain(spotTrade);
    expect(hyperliquidPlugin.actions).toContain(priceCheck);
    expect(hyperliquidPlugin.actions).toContain(cancelOrders);
  });

  it("should have empty providers array", () => {
    expect(hyperliquidPlugin.providers).toEqual([]);
  });

  it("should have empty evaluators array", () => {
    expect(hyperliquidPlugin.evaluators).toEqual([]);
  });

  it("should have empty services array", () => {
    expect(hyperliquidPlugin.services).toEqual([]);
  });

  it("should not have clients array", () => {
    expect(hyperliquidPlugin).not.toHaveProperty("clients");
  });

  it("should be the default export", () => {
    const defaultExport = require("../index").default;
    expect(defaultExport).toBe(hyperliquidPlugin);
  });
});
