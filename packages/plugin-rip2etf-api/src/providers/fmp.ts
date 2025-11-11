import { rip2etfSettings } from "../settings";
import { EtfHoldings, EtfOverview } from "../types";
import { getJSON } from "../utils/fetcher";

const BASE_URL = "https://financialmodelingprep.com/api";

export async function fmpEtfProfile(symbol: string): Promise<Partial<EtfOverview> | null> {
  if (!rip2etfSettings.ENABLE_FMP) return null;
  const key = rip2etfSettings.FMP_API_KEY;
  if (!key) return null;

  const url = `${BASE_URL}/v3/profile/${encodeURIComponent(symbol)}?apikey=${key}`;
  const response = await getJSON<any[]>(url).catch(() => null);
  if (!response || response.length === 0) return null;

  const profile = response[0];
  return {
    name: profile.companyName ?? profile.name ?? profile.symbol,
    issuer: profile.industry ?? profile.companyName,
    category: profile.sector,
    expenseRatio: profile.expensesRatio ? Number(profile.expensesRatio) : undefined,
    inceptionDate: profile.ipoDate,
    domicile: profile.country,
    benchmark: profile.exchangeShortName,
    aumUSD: profile.mktCap ? Number(profile.mktCap) : undefined,
    dataSources: ["fmp"]
  };
}

export async function fmpEtfHoldings(symbol: string): Promise<EtfHoldings | null> {
  if (!rip2etfSettings.ENABLE_FMP) return null;
  const key = rip2etfSettings.FMP_API_KEY;
  if (!key) return null;

  const url = `${BASE_URL}/v4/etf-holder?symbol=${encodeURIComponent(symbol)}&apikey=${key}`;
  const data = await getJSON<any[]>(url).catch(() => null);
  if (!data || data.length === 0) return null;

  const holdings = data.map((row) => ({
    symbol: row.assetSymbol ?? row.symbol ?? undefined,
    name: row.assetName ?? row.name ?? "",
    weightPct: row.weightPercentage ? Number(row.weightPercentage) : undefined,
    shares: row.sharesNumber ? Number(row.sharesNumber) : undefined,
    marketValueUSD: row.marketValue ? Number(row.marketValue) : undefined
  }));

  return {
    symbol,
    asOf: data[0]?.date ?? undefined,
    topHoldings: holdings.slice(0, 10),
    allHoldings: holdings,
    dataSources: ["fmp"]
  };
}
