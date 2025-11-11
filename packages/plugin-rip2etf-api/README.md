# @elizaos/plugin-rip2etf-api

ETF and macro market data provider for Mr. RIP.

## Actions

- `rip2etf.snapshot` – builds a full ETF snapshot (overview, top holdings, performance rebased 100) aggregating free Stooq data plus optional Alpha Vantage, FMP and Finnhub feeds, then renders a Chart.js PNG that gets attached to Discord/Telegram replies.

## Environment

Set these keys (free tiers available):

```
ALPHAVANTAGE_API_KEY=xxxxx
FMP_API_KEY=xxxxx
FINNHUB_API_KEY=xxxxx
FRED_API_KEY=xxxxx

# Optional: enable verbose logging (HTTP calls, dataset selection)
RIP2ETF_DEBUG=true

# Optional: enable each paid endpoint explicitly (defaults = false)
RIP2ETF_ENABLE_ALPHA_VANTAGE=false
RIP2ETF_ENABLE_FMP=false
RIP2ETF_ENABLE_FINNHUB=false
```

## Build

```
pnpm --filter @elizaos/plugin-rip2etf-api build
```
