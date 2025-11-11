import type { Plugin } from "@elizaos/core";
import { snapshotAction } from "./actions/snapshot";

export const rip2etfPlugin: Plugin = {
  name: "@elizaos/plugin-rip2etf-api",
  description:
    "Genera snapshot ETF complete (overview, holdings, confronto performance) usando Stooq come fonte free e, se configurati, Alpha Vantage/FMP/Finnhub, con grafici Chart.js allegati automaticamente.",
  actions: [snapshotAction]
};

export default rip2etfPlugin;
