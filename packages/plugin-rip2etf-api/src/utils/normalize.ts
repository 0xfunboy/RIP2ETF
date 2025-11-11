import { EtfOverview, PriceHistory } from "../types";

export function reconcileOverview(
  symbol: string,
  fragments: Array<Partial<EtfOverview> | null | undefined>
): EtfOverview {
  const merged: EtfOverview = {
    symbol,
    dataSources: []
  };

  for (const fragment of fragments) {
    if (!fragment) continue;

    const { dataSources, ...rest } = fragment;
    Object.entries(rest).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if ((merged as Record<string, unknown>)[key] === undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    });

    if (Array.isArray(dataSources)) {
      merged.dataSources.push(...dataSources);
    }
  }

  merged.dataSources = Array.from(new Set(merged.dataSources));
  return merged;
}

export function alignAndRebase(series: PriceHistory[]): {
  dates: string[];
  table: Array<{ symbol: string; points: Array<{ t: string; v: number }> }>;
  sources: string[];
} {
  if (series.length === 0) {
    return { dates: [], table: [], sources: [] };
  }

  const commonDates = series.reduce<string[]>((acc, ph) => {
    const dates = ph.bars.map((b) => b.t);
    if (acc.length === 0) return dates;
    return acc.filter((d) => dates.includes(d));
  }, []);

  const table = series.map((ph) => {
    const map = new Map(ph.bars.map((b) => [b.t, b.c]));
    const baseline = map.get(commonDates[0]) ?? 1;
    const points = commonDates.map((d) => {
      const price = map.get(d);
      return { t: d, v: price ? (price / baseline) * 100 : NaN };
    });
    return { symbol: ph.symbol, points };
  });

  const sources = Array.from(new Set(series.flatMap((s) => s.dataSources)));
  return { dates: commonDates, table, sources };
}
