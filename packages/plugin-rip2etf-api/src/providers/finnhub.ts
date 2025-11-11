import { rip2etfSettings } from "../settings";
import { EtfOverview } from "../types";
import { getJSON } from "../utils/fetcher";

const BASE_URL = "https://finnhub.io/api/v1";

export async function finnhubEtfProfile(symbol: string): Promise<Partial<EtfOverview> | null> {
  if (!rip2etfSettings.ENABLE_FINNHUB) return null;
  const key = rip2etfSettings.FINNHUB_API_KEY;
  if (!key) return null;

  const url = `${BASE_URL}/etf/profile?symbol=${encodeURIComponent(symbol)}&token=${key}`;
  const profile = await getJSON<Record<string, any>>(url).catch(() => null);
  if (!profile || Object.keys(profile).length === 0) return null;

  return {
    name: profile.name ?? profile.displaySymbol ?? profile.symbol,
    category: profile.category,
    issuer: profile.issuerName ?? profile.issuer,
    expenseRatio: profile.expenseRatio ? Number(profile.expenseRatio) : undefined,
    benchmark: profile.benchmark,
    dataSources: ["finnhub"]
  };
}
