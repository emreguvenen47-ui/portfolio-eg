/** Core domain types. Everything price-related flows through these. */

export type AssetClass =
  | "Cash"
  | "Equity"
  | "Commodity"
  | "Alternative"
  | "Unallocated";

export type Region =
  | "Turkey"
  | "US"
  | "Europe"
  | "China"
  | "EM"
  | "Global"
  | "Unallocated";

/**
 * How an instrument is priced.
 *  - `etf`          exchange-traded, quotable via provider
 *  - `index_proxy`  we track an index (e.g. BIST 100) rather than a tradable line
 *  - `cash_fund`    NOT exchange-traded (PPF). Accrues a yield; never quoted.
 *  - `unallocated`  dry powder, parked in T-bills
 */
export type InstrumentKind = "etf" | "index_proxy" | "cash_fund" | "unallocated";

/** A row exactly as it appears in the workbook, before any enrichment. */
export interface RawPositionRow {
  index: number;
  code: string;
  name: string;
  category: string;
  weight: number; // 0..1
  amount: number; // base currency (USD)
  expectedReturn: number; // 0..1 annual
  volatility: number; // 0..1 annual
  currency: string; // as written in the sheet
  rationale: string;
  risks: string;
}

/** Raw row + everything we derive from it. */
export interface Position extends RawPositionRow {
  assetClass: AssetClass;
  region: Region;
  kind: InstrumentKind;
  /** Provider symbol, or null when the instrument is not quotable (PPF). */
  symbol: string | null;
  /** True when `symbol` is a stand-in rather than the instrument itself. */
  isProxy: boolean;
  proxyNote?: string;
  themes: string[];
  /** Target weight = the workbook weight. Current weight drifts with prices. */
  targetWeight: number;
  currencyCode: "USD" | "TRY" | "EUR" | "MIXED";
}

export interface PortfolioMeta {
  title: string;
  baseCurrency: "USD";
  totalAmount: number;
  sourceFile: string;
  parsedAt: string;
  /** Assumption rows lifted from the "Özet" sheet, if present. */
  summary: Record<string, number>;
  warnings: string[];
}

export interface Portfolio {
  meta: PortfolioMeta;
  positions: Position[];
}

// ---------------------------------------------------------------- market data

/**
 * Quote status.
 *
 *  - `LIVE`          a real quote from an open venue, refreshed recently
 *  - `MARKET_CLOSED` the venue's last official print, venue currently shut.
 *                    NOT stale — an unchanged closed-market price is correct.
 *  - `STALE`         a real quote we can no longer refresh, or one too old
 *  - `UNAVAILABLE`   no real quote exists; nothing is displayed as a price
 *
 * There is deliberately no DEMO member. Generated prices are a development
 * fixture, never a runtime state, so the type cannot express one.
 */
export type DataStatus = "LIVE" | "MARKET_CLOSED" | "STALE" | "UNAVAILABLE";

export interface Quote {
  symbol: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  currency: string;
  /** Venue timestamp from the provider — when the price actually printed. */
  timestamp: string;
  /** When we retrieved it. Diverges from `timestamp` on a closed venue. */
  fetchedAt: string;
  /** Which provider answered, so the UI can attribute the number. */
  provider: string;
  status: DataStatus;
  /** Present when we are serving a cached value after a failed refresh. */
  fallbackReason?: string;
}

export interface Candle {
  /** yyyy-mm-dd */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface HistorySeries {
  symbol: string;
  candles: Candle[];
  status: DataStatus;
  fallbackReason?: string;
}

export interface FxRate {
  pair: string; // "USD/TRY"
  rate: number;
  changePercent: number;
  status: DataStatus;
  timestamp: string;
}

export interface MarketDataProvider {
  name: string;
  /**
   * False when the provider structurally cannot serve candles (free-tier
   * restriction, FX-only source, ...). Lets the orchestrator skip it instead
   * of issuing a call that is guaranteed to throw.
   */
  supportsHistory?: boolean;
  getQuote(symbol: string): Promise<Quote>;
  getQuotes(symbols: string[]): Promise<Record<string, Quote>>;
  getHistoricalPrices(
    symbol: string,
    opts?: { outputsize?: number; interval?: string },
  ): Promise<HistorySeries>;
  /**
   * Optional bulk history. Providers that can serve many symbols in one
   * request implement this so a portfolio refresh is a single round trip
   * instead of one per holding. May omit symbols it cannot resolve.
   */
  getHistories?(
    symbols: string[],
    opts?: { outputsize?: number; interval?: string },
  ): Promise<Record<string, HistorySeries>>;
  /**
   * Optional intraday bars for the 1D / 5D chart ranges. Providers without an
   * intraday endpoint omit it and the orchestrator skips them.
   */
  getIntraday?(symbol: string, range: "1D" | "5D"): Promise<HistorySeries>;
  getFxRate(pair: string): Promise<FxRate>;
  getIndexQuote(symbol: string): Promise<Quote>;
}

// ---------------------------------------------------------------- analytics

export interface PositionValuation {
  position: Position;
  quote: Quote | null;
  /** Marked value in USD. */
  value: number;
  costBasis: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  dailyPnl: number;
  dailyPct: number;
  ytdPct: number | null;
  currentWeight: number;
  targetWeight: number;
  drift: number; // current - target, in weight points
  contributionToReturn: number; // weight * ytd, in portfolio points
}

export interface RiskMetrics {
  annualVolatility: number; // from covariance matrix
  weightedAvgVolatility: number; // the naive number, shown for contrast only
  diversificationBenefit: number;
  expectedReturn: number;
  sharpe: number;
  maxDrawdown: number;
  beta: number | null;
  var95: number;
  var99: number;
  expectedShortfall95: number;
  riskContributions: { code: string; weight: number; rc: number; pctRc: number }[];
  observations: number;
  method: "historical" | "model";
}

export interface StressShock {
  /** Position code or a factor key like "SPX". */
  target: string;
  shockPct: number;
}

export interface StressScenario {
  id: string;
  name: string;
  description: string;
  shocks: StressShock[];
  editable: boolean;
}

export interface StressResult {
  scenarioId: string;
  portfolioPct: number;
  dollarPnl: number;
  byPosition: { code: string; pct: number; dollar: number }[];
  largestLoss: { code: string; dollar: number } | null;
  largestHedge: { code: string; dollar: number } | null;
}

export type ThesisStatus = "GREEN" | "YELLOW" | "RED";

export interface Thesis {
  code: string;
  thesis: string;
  drivers: string[];
  risks: string[];
  status: ThesisStatus;
  confidence: number; // 0..100
  invalidation: string;
  keyIndicators: string[];
  lastReview: string;
  notes: string;
}

export type RiskRegime = "RISK ON" | "NEUTRAL" | "RISK OFF";

export interface RegimeSignal {
  key: string;
  label: string;
  value: string;
  vote: "on" | "off" | "neutral";
  detail: string;
}

export interface RegimeAssessment {
  regime: RiskRegime;
  score: number;
  signals: RegimeSignal[];
}
