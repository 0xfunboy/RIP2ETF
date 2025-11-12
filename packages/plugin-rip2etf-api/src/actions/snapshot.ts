import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type HandlerOptions,
  type IAgentRuntime,
  type Media,
  type Memory,
  type State,
  ContentType,
  ensureCorrelationId,
  isDebugFlagEnabled
} from "@elizaos/core";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { alphaVantageDaily } from "../providers/alphaVantage";
import { stooqDaily } from "../providers/stooq";
import { fmpEtfProfile, fmpEtfHoldings } from "../providers/fmp";
import { finnhubEtfProfile } from "../providers/finnhub";
import { manualHoldings, manualOverview } from "../data/manual";
import { alignAndRebase, reconcileOverview } from "../utils/normalize";
import { createLineChartImage } from "../utils/charts";
import { collectSymbols } from "../utils/tickers";
import { debugLog } from "../utils/logger";
import type { EtfHoldings, EtfOverview, PriceHistory } from "../types";

const MAX_HISTORY_POINTS = 180;
const MAX_COMPARISONS = 4;
const ATTACHMENTS_DEBUG_ENABLED = isDebugFlagEnabled("ATTACHMENTS_DEBUG");
const CHART_DUMP_DEBUG_ENABLED = isDebugFlagEnabled("CHART_DUMP_DEBUG");

interface SymbolDataset {
  overview: EtfOverview;
  holdings: EtfHoldings | null;
  history: PriceHistory | null;
}

function formatCurrency(value?: number) {
  if (value === undefined || Number.isNaN(value)) return "n/d";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B$`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M$`;
  return `${value.toFixed(0)}$`;
}

function formatPercent(value?: number) {
  if (value === undefined || Number.isNaN(value)) return "n/d";
  return `${value.toFixed(2)}%`;
}

function pickTop(holdings: { name: string; weightPct?: number }[], top = 5) {
  return holdings
    .filter((h) => h.name)
    .slice(0, top)
    .map((h, idx) => `${idx + 1}. ${h.name}${h.weightPct ? ` (${h.weightPct.toFixed(2)}%)` : ""}`)
    .join("\n");
}

function hasOverviewData(overview?: EtfOverview): boolean {
  if (!overview) return false;
  return Boolean(
    overview.issuer ||
      overview.category ||
      overview.benchmark ||
      overview.expenseRatio !== undefined ||
      overview.aumUSD !== undefined ||
      overview.navUSD !== undefined ||
      overview.name
  );
}

const hasHoldingsData = (holdings?: EtfHoldings | null) =>
  Boolean(holdings?.topHoldings && holdings.topHoldings.length > 0);

const hasHistoryData = (history?: PriceHistory | null) =>
  Boolean(history?.bars && history.bars.length > 0);

function isAgentMessage(runtime: IAgentRuntime, message: Memory): boolean {
  if (!message) return false;

  const agentId = runtime.agentId;
  if (agentId && message.entityId === agentId) {
    return true;
  }

  const role = (message.content as any)?.role;
  if (typeof role === "string" && role.toLowerCase() === "assistant") {
    return true;
  }

  const author = (message.content as any)?.author;
  if (author && typeof author === "object" && "id" in author && author.id === agentId) {
    return true;
  }

  const sourceTag = message.metadata?.source;
  if (sourceTag && sourceTag.startsWith("rip2etf.snapshot")) {
    return true;
  }

  const tags = message.metadata?.tags;
  if (Array.isArray(tags) && tags.some((tag) => typeof tag === "string" && tag.includes("agent"))) {
    return true;
  }

  return false;
}

async function fetchSymbolDataset(symbol: string, corrId: string): Promise<SymbolDataset> {
  const [overviewPrimary, overviewExtra] = await Promise.all([
    fmpEtfProfile(symbol),
    finnhubEtfProfile(symbol)
  ]);

  const overview = reconcileOverview(symbol, [overviewPrimary, overviewExtra, manualOverview(symbol)]);
  const holdings = (await fmpEtfHoldings(symbol)) ?? manualHoldings(symbol);

  let history = await alphaVantageDaily(symbol);
  if (!history?.bars?.length) {
    history = await stooqDaily(symbol, { corrId });
  }

  return {
    overview,
    holdings: holdings ?? null,
    history: history ?? null
  };
}

async function buildSnapshot(
  runtime: IAgentRuntime,
  message: Memory,
  state: State | undefined,
  options: HandlerOptions | undefined,
  _callback: HandlerCallback | undefined,
  responses: Memory[] | undefined,
  corrId: string
): Promise<ActionResult> {
  const collected = collectSymbols({ message, state, options, responses, limit: 6 });
  const candidates = Array.from(
    new Set(collected.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))
  );

  debugLog("snapshot_candidates", candidates);

  if (!candidates.length) {
    const explanation =
      "Non ho trovato ticker validi nel messaggio. Indica almeno un simbolo ETF (es. VOO) e riprovo.";

    return {
      text: explanation,
      success: false,
      data: {
        actionName: "rip2etf.snapshot",
        reason: "missing_symbol"
      }
    };
  }

  const symbolDataMap = new Map<string, SymbolDataset>();
  for (const candidate of candidates) {
    try {
      debugLog("dataset_fetch_start", candidate);
      const dataset = await fetchSymbolDataset(candidate, corrId);
      symbolDataMap.set(candidate, dataset);
      debugLog("dataset_fetch_success", {
        symbol: candidate,
        hasOverview: hasOverviewData(dataset.overview),
        hasHoldings: hasHoldingsData(dataset.holdings),
        hasHistory: hasHistoryData(dataset.history)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtime.logger?.warn?.(
        { error: message, candidate },
        "[rip2etf.snapshot] Impossibile recuperare dati per il simbolo"
      );
      debugLog("dataset_fetch_error", { symbol: candidate, error: message });
    }
  }

  let primarySymbol: string | undefined;
  for (const candidate of candidates) {
    const dataset = symbolDataMap.get(candidate);
    if (!dataset) continue;
    if (
      hasOverviewData(dataset.overview) ||
      hasHoldingsData(dataset.holdings) ||
      hasHistoryData(dataset.history)
    ) {
      primarySymbol = candidate;
      break;
    }
  }

  if (!primarySymbol) {
    debugLog("snapshot_no_primary", { candidates });
    const failureText =
      "Non sono riuscito a trovare dati affidabili per i simboli indicati. Controlla i ticker (es. VOO, VWCE) e riprova.";

    return {
      text: failureText,
      success: false,
      data: {
        actionName: "rip2etf.snapshot",
        error: "no_data_for_symbols"
      }
    };
  }

  const primaryData = symbolDataMap.get(primarySymbol)!;
  debugLog("snapshot_primary", {
    primarySymbol,
    compareCandidates: candidates.filter((c) => c !== primarySymbol)
  });

  const compareSymbols = candidates
    .filter((symbol) => symbol !== primarySymbol && hasHistoryData(symbolDataMap.get(symbol)?.history))
    .slice(0, MAX_COMPARISONS);

  const peers = [primarySymbol, ...compareSymbols];
  const histories = peers
    .map((symbol) => symbolDataMap.get(symbol)?.history)
    .filter((history): history is PriceHistory => Boolean(history && history.bars.length));

  const { dates, table, sources } = histories.length
    ? alignAndRebase(histories)
    : { dates: [] as string[], table: [] as { symbol: string; points: Array<{ t: string; v: number }> }[], sources: [] as string[] };

  const limitedDates = dates.slice(-MAX_HISTORY_POINTS);
  const limitedTable = table.map((series) => ({
    symbol: series.symbol,
    points: series.points.slice(-MAX_HISTORY_POINTS)
  }));

  const datasets = limitedTable.map((series) => ({
    label: series.symbol,
    data: series.points.map((point) =>
      Number.isFinite(point.v) ? Number(point.v.toFixed(2)) : null
    )
  }));

  const hasChartDataset =
    limitedDates.length > 1 && datasets.some((series) => series.data.some((value) => value !== null));

  const chartTitle = `Andamento ultimi ${limitedDates.length || "0"} giorni`;
  const chartResult = hasChartDataset
    ? await createLineChartImage(limitedDates, datasets, chartTitle)
    : null;

  const chartAttachment: Media | undefined = chartResult
    ? {
        id: `rip2etf-chart-${primarySymbol}-${Date.now()}`,
        url: chartResult.chartUrl?.startsWith("data:")
          ? chartResult.fileName
          : chartResult.chartUrl,
        data: chartResult.buffer,
        filename: chartResult.fileName,
        mimeType: chartResult.mimeType,
        title: chartTitle,
        description: `Performance rebased 100 (${limitedDates.length} giorni)`,
        source: "rip2etf.snapshot",
        contentType: ContentType.IMAGE
      }
    : undefined;

  debugLog("snapshot_chart", {
    enabled: Boolean(chartAttachment),
    dates: limitedDates.length,
    series: datasets.map((ds) => ds.label)
  });

  if (chartAttachment && chartResult && (ATTACHMENTS_DEBUG_ENABLED || CHART_DUMP_DEBUG_ENABLED)) {
    const sha1Full = createHash("sha1").update(chartResult.buffer).digest("hex");
    const sha1Short = sha1Full.slice(0, 8);

    if (ATTACHMENTS_DEBUG_ENABLED) {
      runtime.logger?.info?.(
        `snapshot:chart:queued corrId=${corrId} kind=image mime=${chartAttachment.mimeType ?? "image/png"} filename=${chartAttachment.filename ?? "rip2etf-chart.png"} bytes=${chartResult.buffer.byteLength} sha1=${sha1Short}`
      );
    }

    if (CHART_DUMP_DEBUG_ENABLED) {
      const safeCorr = corrId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const dumpPath = `/tmp/rip2etf-${safeCorr}.png`;
      try {
        await fs.writeFile(dumpPath, chartResult.buffer);
        runtime.logger?.info?.(`snapshot:chart:dump corrId=${corrId} path=${dumpPath} sha1=${sha1Short}`);
      } catch (error) {
        runtime.logger?.warn?.(
          {
            error: (error as Error).message,
            corrId,
            path: dumpPath
          },
          "snapshot:chart:dump:failed"
        );
      }
    }
  }

  const latestRow = limitedTable.map((series) => {
    const lastValid = [...series.points].reverse().find((point) => Number.isFinite(point.v));
    return `${series.symbol}: ${lastValid ? Number(lastValid.v).toFixed(1) : "n/d"}`;
  });

  const responseSections = [
    `**${primarySymbol} · snapshot dati**`,
    `- Issuer: ${primaryData.overview.issuer ?? "n/d"}`,
    `- Categoria: ${primaryData.overview.category ?? "n/d"}`,
    `- Benchmark: ${primaryData.overview.benchmark ?? "n/d"}`,
    `- TER: ${formatPercent(primaryData.overview.expenseRatio)}`,
    `- AUM: ${formatCurrency(primaryData.overview.aumUSD)}`,
    `- NAV: ${formatCurrency(primaryData.overview.navUSD)} (ultimo close ${primaryData.overview.lastCloseDate ?? "n/d"})`
  ];

  if (hasHoldingsData(primaryData.holdings)) {
    responseSections.push("", `Top holdings:\n${pickTop(primaryData.holdings!.topHoldings)}`);
  }

  if (limitedTable.length > 0) {
    responseSections.push(
      "",
      `Performance rebased 100 (${limitedDates.length} giorni):`,
      latestRow.join(" | "),
      sources.length ? `Fonti prezzo: ${sources.join(", ")}` : ""
    );
  }

  if (compareSymbols.length > 0) {
    responseSections.push("", `Confronto con: ${compareSymbols.join(", ")}`);
  }

  if (chartAttachment) {
    responseSections.push("", "Grafico Chart.js allegato in coda.");
  }

  const responseText = responseSections.filter(Boolean).join("\n");
  debugLog("snapshot_summary", responseText);

  const snapshotSummary = responseText;
  const snapshotPayload = {
    primarySymbol,
    compareSymbols,
    overview: primaryData.overview,
    holdings: primaryData.holdings,
    chartUrl: chartResult?.chartUrl,
    chartAttached: Boolean(chartAttachment),
    priceSources: sources,
    summary: snapshotSummary
  };

  const snapshotAttachments = chartAttachment ? [chartAttachment] : [];

  return {
    text: responseText,
    success: true,
    data: {
      actionName: "rip2etf.snapshot",
      symbol: primarySymbol,
      compareWith: compareSymbols,
      overview: primaryData.overview,
      holdings: primaryData.holdings,
      chartUrl: chartResult?.chartUrl,
      chartAttached: Boolean(chartAttachment),
      priceSources: sources,
      summary: snapshotSummary
    },
    values: {
      primarySymbol,
      compareSymbols,
      priceSources: sources,
      snapshotSummary,
      snapshotData: snapshotPayload,
      snapshotAttachments,
      pendingAttachments: snapshotAttachments
    }
  };
}

export const snapshotAction: Action = {
  name: "rip2etf.snapshot",
  description:
    "Sintesi completa di uno o più ETF con overview, holdings principali, confronto performance e grafico pronto da condividere.",
  similes: ["RIP2ETF_SNAPSHOT", "ETF_SNAPSHOT", "ETF_REPORT", "RIP2ETF_REPORT"],
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    if (isAgentMessage(runtime, message)) {
      debugLog("snapshot_skip_self_validate", message.id ?? "unknown");
      return false;
    }

    const tickers = collectSymbols({ message, limit: 1 });
    return tickers.length > 0;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    options: HandlerOptions | undefined,
    callback?: HandlerCallback,
    responses?: Memory[]
  ) => {
    state = state ?? ({ values: {}, data: {} } as State);
    state.values = state.values || {};

    if (isAgentMessage(runtime, message)) {
      debugLog("snapshot_skip_self_handler", message.id ?? "unknown");
      return {
        success: false,
        data: {
          actionName: "rip2etf.snapshot",
          error: "IGNORED_SELF_MESSAGE"
        }
      };
    }

    const corrId = ensureCorrelationId(state, message);
    const cacheKey = `${message.roomId ?? "room"}:${corrId}`;
    const cache =
      (state.values.__snapshotCache as Record<string, ActionResult | undefined>) || {};

    if (cache[cacheKey]) {
      debugLog("snapshot_cache_hit", { corrId, cacheKey });
      return cache[cacheKey]!;
    }

    try {
      const result = await buildSnapshot(
        runtime,
        message,
        state,
        options,
        callback,
        responses,
        corrId
      );

      cache[cacheKey] = result;
      state.values.__snapshotCache = cache;

      return result;
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Errore inatteso durante la generazione snapshot";

      runtime.logger?.error?.(
        {
          error: reason,
          stack: error instanceof Error ? error.stack : undefined
        },
        "[rip2etf.snapshot] fallita"
      );
      debugLog("snapshot_failure", { error: reason });

      const failureText = `Impossibile completare la snapshot per ora (${reason}). Riprova tra poco.`;

      if (callback) {
        await callback({
          text: failureText,
          actions: ["rip2etf.snapshot"]
        });
      }

      return {
        text: failureText,
        success: false,
        data: {
          actionName: "rip2etf.snapshot",
          error: reason
        }
      };
    }
  }
};
