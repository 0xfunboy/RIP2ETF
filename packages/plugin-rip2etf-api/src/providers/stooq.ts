import { PriceHistory } from "../types";
import { getText } from "../utils/fetcher";
import { debugLog } from "../utils/logger";

const SUFFIXES = ["", ".us", ".de", ".uk", ".ln", ".pa", ".hk", ".jp"];

function buildTickerVariants(symbol: string): string[] {
  const base = symbol.toLowerCase();
  const explicit: Record<string, string[]> = {
    voo: ["voo.us", "voo"],
    vwce: ["vwce.de", "vwce"],
    spy: ["spy.us", "spy"],
    iwda: ["iwda", "iwda.de", "iwda.nl"],
    qqq: ["qqq.us", "qqq"]
  };

  const variants = explicit[base] ?? SUFFIXES.map((suffix) => `${base}${suffix}`);
  return Array.from(new Set(variants));
}

interface StooqOptions {
  corrId?: string;
}

export async function stooqDaily(symbol: string, options: StooqOptions = {}): Promise<PriceHistory | null> {
  const { corrId } = options;
  for (const candidate of buildTickerVariants(symbol)) {
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(candidate)}&i=d`;
    let csv = "";
    try {
      csv = await getText(url);
      if (corrId) {
        debugLog("etl:fetch", {
          corrId,
          provider: "stooq",
          symbol,
          url,
          status: 200,
          bytes: csv.length
        });
      }
    } catch (error) {
      if (corrId) {
        debugLog("etl:fetch:error", {
          corrId,
          provider: "stooq",
          symbol,
          url,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      continue;
    }
    if (!csv || !csv.includes("Date") || /No data/i.test(csv)) {
      if (corrId) {
        debugLog("etl:fetch", {
          corrId,
          provider: "stooq",
          symbol,
          url,
          status: 200,
          bytes: csv.length,
          empty: true
        });
      }
      continue;
    }

    const lines = csv.trim().split("\n");
    const header = lines.shift();
    if (!header || !header.startsWith("Date")) {
      continue;
    }

    const bars = lines
      .map((line) => {
        const [date, open, high, low, close, volume] = line.split(",");
        return {
          t: date,
          o: parseFloat(open),
          h: parseFloat(high),
          l: parseFloat(low),
          c: parseFloat(close),
          v: volume ? parseFloat(volume) : undefined
        };
      })
      .filter((bar) => Number.isFinite(bar.c));

    if (!bars.length) {
      continue;
    }

    const priceHistory: PriceHistory = {
      symbol,
      interval: "1d",
      bars,
      adjusted: false,
      dataSources: ["stooq"],
      sourceSymbol: candidate
    };

    return priceHistory;
  }

  return null;
}
