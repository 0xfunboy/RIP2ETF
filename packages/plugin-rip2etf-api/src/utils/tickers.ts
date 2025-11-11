import type { HandlerOptions, Memory, State } from "@elizaos/core";

const STOP_WORDS = new Set([
  "ETF",
  "ETFS",
  "INDICE",
  "INDEX",
  "SP",
  "USA",
  "USD",
  "EUR",
  "CHF",
  "MR",
  "RIP",
  "FIRE",
  "VS",
  "E",
  "DI",
  "DEL",
  "DELLA",
  "DEI",
  "DEGLI",
  "DAL",
  "DALLA",
  "CON",
  "PER",
  "NEL",
  "NELLA",
  "NEI",
  "NELLE",
  "GLI",
  "LE",
  "IL",
  "LO",
  "LA",
  "UNA",
  "UNO",
  "UN",
  "ANCHE",
  "GRAFICO",
  "GRAFICI",
  "SNAPSHOT",
  "COMPARA",
  "CONFRONTA",
  "CHECK",
  "PUOI",
  "PUÒ",
  "DAMMI",
  "DARMI",
  "DAMI",
  "DARTI",
  "CHIEDO",
  "VOGLIO",
  "PANORAMICA",
  "AGGIORNATA",
  "CONFRONTO",
  "ULTIMI",
  "MESI",
  "MAGARI",
  "INCLUDENDO",
  "ANDAMENTO",
  "ORA",
  "STO",
  "PREPARANDO",
  "GENERANDO",
  "RISULTATI",
  "ISSUER",
  "BENCHMARK",
  "CATEGORIA",
  "TER",
  "TOP",
  "HOLDINGS",
  "PERFORMANCE",
  "NUOVO",
  "NUOVAMENTE",
  "PREGO"
]);

const TICKER_REGEX = /\b[A-Z]{2,6}(?:\.[A-Z]{1,3})?\b/g;

const PHRASE_ALIAS_MAP: Record<string, string> = {
  "S&P 500": "SP500",
  "S&P500": "SP500",
  "S & P 500": "SP500",
  "SP 500": "SP500",
  "SNP 500": "SP500",
  "NASDAQ 100": "NASDAQ100",
  "NASDAQ-100": "NASDAQ100",
  "NASDAQ COMPOSITE": "NASDAQ",
  "NASDAQ": "NASDAQ",
  "DOW JONES": "DOWJONES",
  "DOW 30": "DOW30",
};

const PRIMARY_ALIAS_MAP: Record<string, string> = {
  SP500: "SPY",
  "S&P500": "SPY",
  "S&P": "SPY",
  SPX: "SPY",
  SNP: "SPY",
  GSPC: "SPY",
  NASDAQ: "QQQ",
  NASDAQ100: "QQQ",
  NAS100: "QQQ",
  NDX: "QQQ",
  IXIC: "QQQ",
  DOWJONES: "DIA",
  DOW: "DIA",
  DJIA: "DIA",
  DOW30: "DIA"
};

function normalizePhrases(text: string): string {
  let normalized = text;
  for (const [phrase, replacement] of Object.entries(PHRASE_ALIAS_MAP)) {
    const pattern = new RegExp(escapeRegExp(phrase), "gi");
    normalized = normalized.replace(pattern, ` ${replacement} `);
  }
  return normalized;
}

function extractFromText(target: Set<string>, text: string) {
  if (!text) return;
  const matches = normalizePhrases(text).match(TICKER_REGEX);
  if (!matches) return;
  for (const raw of matches) {
    const token = raw.replace(/[^\w.]/g, "");
    if (!token || token.length < 3) continue;
    const upper = token.toUpperCase();
    if (STOP_WORDS.has(upper)) continue;
    const normalized = PRIMARY_ALIAS_MAP[upper] ?? upper;
    if (STOP_WORDS.has(normalized)) continue;
    target.add(normalized);
  }
}

function addCandidate(set: Set<string>, value: unknown) {
  if (!value) return;
  if (typeof value === "string") {
    extractFromText(set, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => addCandidate(set, item));
    return;
  }
  if (typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) => addCandidate(set, item));
  }
}

export interface SymbolExtractionParams {
  message: Memory;
  state?: State;
  options?: HandlerOptions;
  responses?: Memory[];
  fallbackSymbols?: string[];
  limit?: number;
}

function normalizeSymbol(candidate: unknown): string | null {
  if (!candidate || typeof candidate !== "string") return null;
  const token = candidate.replace(/[^\w.]/g, "").trim();
  if (!token || token.length < 2) return null;
  const upper = token.toUpperCase();
  if (STOP_WORDS.has(upper)) return null;
  return upper;
}

function limitResult(set: Set<string>, limit?: number) {
  const result = Array.from(set);
  return typeof limit === "number" && limit > 0 ? result.slice(0, limit) : result;
}

export function collectSymbols({
  message,
  fallbackSymbols,
  limit
}: SymbolExtractionParams): string[] {
  const messageSymbols = new Set<string>();

  if (message?.content) {
    addCandidate(messageSymbols, (message.content as any).symbol);
    addCandidate(messageSymbols, (message.content as any).symbols);
    if (typeof message.content.text === "string") {
      extractFromText(messageSymbols, message.content.text);
    }
  }

  if (messageSymbols.size > 0) {
    if (fallbackSymbols) {
      for (const symbol of fallbackSymbols) {
        const normalized = normalizeSymbol(symbol);
        if (normalized) {
          messageSymbols.add(normalized);
        }
      }
    }
    return limitResult(messageSymbols, limit);
  }

  const fallbackSet = new Set<string>();
  if (fallbackSymbols) {
    for (const symbol of fallbackSymbols) {
      const normalized = normalizeSymbol(symbol);
      if (normalized) {
        fallbackSet.add(normalized);
      }
    }
  }

  return limitResult(fallbackSet, limit);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
