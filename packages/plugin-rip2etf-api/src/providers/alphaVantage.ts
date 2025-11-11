import { rip2etfSettings } from "../settings";
import { PriceHistory } from "../types";
import { getJSON } from "../utils/fetcher";
import { debugLog } from "../utils/logger";

const BASE_URL = "https://www.alphavantage.co/query";

export async function alphaVantageDaily(symbol: string): Promise<PriceHistory | null> {
  if (!rip2etfSettings.ENABLE_ALPHA_VANTAGE) {
    debugLog("alphavantage_skip", {
      symbol,
      reason: "disabled"
    });
    return null;
  }

  const key = rip2etfSettings.ALPHAVANTAGE_API_KEY;
  if (!key) return null;

  const url = `${BASE_URL}?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(
    symbol
  )}&outputsize=compact&apikey=${key}`;

  const json = (await getJSON<Record<string, any>>(url).catch(() => null)) ?? {};

  const message = (json && (json.Information || json.Note || json["Error Message"])) as
    | string
    | undefined;

  if (message) {
    debugLog("alphavantage_throttle", {
      symbol,
      message
    });
    return null;
  }

  const series = json["Time Series (Daily)"]; // eslint-disable-line @typescript-eslint/no-unsafe-assignment

  if (!series || typeof series !== "object") {
    return null;
  }

  const bars = Object.entries(series as Record<string, Record<string, string>>)
    .map(([date, values]) => ({
      t: date,
      o: parseFloat(values["1. open"]),
      h: parseFloat(values["2. high"]),
      l: parseFloat(values["3. low"]),
      c: parseFloat(values["4. close"]),
      v: parseFloat(values["6. volume"])
    }))
    .filter((bar) => Number.isFinite(bar.c))
    .sort((a, b) => a.t.localeCompare(b.t));

  return {
    symbol,
    interval: "1d",
    bars,
    adjusted: true,
    dataSources: ["alphaVantage"]
  };
}
