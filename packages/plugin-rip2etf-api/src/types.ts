export type Ticker = string;

export interface EtfOverview {
  symbol: Ticker;
  name?: string;
  category?: string;
  issuer?: string;
  expenseRatio?: number;
  inceptionDate?: string;
  domicile?: string;
  benchmark?: string;
  aumUSD?: number;
  navUSD?: number;
  lastCloseUSD?: number;
  lastCloseDate?: string;
  dataSources: string[];
}

export interface Holding {
  symbol?: string;
  name: string;
  weightPct?: number;
  shares?: number;
  marketValueUSD?: number;
}

export interface EtfHoldings {
  symbol: Ticker;
  asOf?: string;
  topHoldings: Holding[];
  allHoldings?: Holding[];
  dataSources: string[];
}

export interface Bar {
  t: string;
  o?: number;
  h?: number;
  l?: number;
  c: number;
  v?: number;
}

export interface PriceHistory {
  symbol: Ticker;
  interval: "1d" | "1h" | "15m";
  bars: Bar[];
  adjusted?: boolean;
  currency?: string;
  dataSources: string[];
  sourceSymbol?: string;
}

export interface CompareSeries {
  symbol: Ticker;
  points: Array<{ t: string; v: number }>;
}

export interface CompareResult {
  dates: string[];
  table: CompareSeries[];
  dataSources: string[];
}
