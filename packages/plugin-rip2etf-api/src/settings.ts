export interface Rip2EtfSettings {
  ALPHAVANTAGE_API_KEY: string;
  FMP_API_KEY: string;
  FINNHUB_API_KEY: string;
  FRED_API_KEY: string;
  DEBUG: boolean;
  ENABLE_ALPHA_VANTAGE: boolean;
  ENABLE_FMP: boolean;
  ENABLE_FINNHUB: boolean;
}

const env = (key: string) => process.env[key]?.trim() ?? "";
const truthy = (value: string) => /^(1|true|yes|on|debug)$/i.test(value);
const boolEnv = (key: string, defaultValue = false) => {
  const raw = env(key);
  if (!raw) return defaultValue;
  return truthy(raw);
};

export const rip2etfSettings: Rip2EtfSettings = {
  ALPHAVANTAGE_API_KEY: env("ALPHAVANTAGE_API_KEY"),
  FMP_API_KEY: env("FMP_API_KEY"),
  FINNHUB_API_KEY: env("FINNHUB_API_KEY"),
  FRED_API_KEY: env("FRED_API_KEY"),
  DEBUG: truthy(env("RIP2ETF_DEBUG")),
  ENABLE_ALPHA_VANTAGE: boolEnv("RIP2ETF_ENABLE_ALPHA_VANTAGE"),
  ENABLE_FMP: boolEnv("RIP2ETF_ENABLE_FMP"),
  ENABLE_FINNHUB: boolEnv("RIP2ETF_ENABLE_FINNHUB")
};

export const hasAnyApiKey = () =>
  !!(
    (rip2etfSettings.ENABLE_ALPHA_VANTAGE && rip2etfSettings.ALPHAVANTAGE_API_KEY) ||
    (rip2etfSettings.ENABLE_FMP && rip2etfSettings.FMP_API_KEY) ||
    (rip2etfSettings.ENABLE_FINNHUB && rip2etfSettings.FINNHUB_API_KEY)
  );
