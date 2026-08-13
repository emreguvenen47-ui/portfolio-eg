import type { AssetClass, InstrumentKind } from "@/lib/types";

/**
 * ============================================================================
 * ASSUMPTIONS FILE
 * ============================================================================
 * Everything in here is metadata that does NOT exist in the workbook: provider
 * symbols, theme tags and factor loadings.
 *
 * Weights, amounts, expected returns, volatilities, currencies and categories
 * are ALWAYS read from Excel and never duplicated here.
 * ============================================================================
 */

export interface SymbolClassification {
  kind: InstrumentKind;
  symbol: string | null;
  isProxy: boolean;
  proxyNote?: string;
}

/** Codes that are not exchange-traded, matched by pattern rather than a list. */
const CASH_FUND = /^(ppf|para\s*piyasas|money\s*market|mmf)$/i;
const UNALLOCATED = /^(a[çc][ıi]k|acik|unalloc|cash|reserve|tbd)$/i;
const INDEX_PROXY: Record<string, { symbol: string; note: string }> = {
  BIST: {
    symbol: "XU100",
    note: "Tracks the BIST 100 index. Your actual holding is a fund/basket, so tracking error applies.",
  },
};

export function classifySymbol(code: string, assetClass: AssetClass): SymbolClassification {
  const c = code.trim().toLocaleUpperCase("tr");

  if (CASH_FUND.test(c)) {
    return {
      kind: "cash_fund",
      symbol: null,
      isProxy: false,
      proxyNote:
        "Not exchange-traded. Valued from an accrual yield, never from a market quote.",
    };
  }
  if (UNALLOCATED.test(c) || assetClass === "Unallocated") {
    return {
      kind: "unallocated",
      symbol: "SGOV",
      isProxy: true,
      proxyNote: "Undecided sleeve. Priced against SGOV (0–3M T-bills) as a parking proxy.",
    };
  }
  const idx = INDEX_PROXY[c];
  if (idx) {
    return { kind: "index_proxy", symbol: idx.symbol, isProxy: true, proxyNote: idx.note };
  }
  return { kind: "etf", symbol: c, isProxy: false };
}

/** Theme tags, derived from the workbook's own category text where possible. */
export function themesFor(code: string, category: string, assetClass: AssetClass): string[] {
  const t = new Set<string>();
  const c = category.toLocaleLowerCase("tr");
  const k = code.toLocaleUpperCase("tr");

  if (/tematik|semiconduct|yar[ıi] iletken/.test(c) || k === "SMH") t.add("AI / Semis");
  if (/b[üu]y[üu]me|growth/.test(c) || k === "QQQ") t.add("AI / Mega-cap Tech");
  if (/sanayi|industrial/.test(c) || k === "XLI") {
    t.add("Electrification / Grid");
    t.add("Reindustrialisation");
  }
  if (k === "CPER" || /bak[ıi]r|copper|sanayi metali/.test(c)) {
    t.add("Electrification / Grid");
    t.add("Scarcity / Real Assets");
  }
  if (k === "GLDM" || /alt[ıi]n|gold|de[ğg]erli metal/.test(c)) {
    t.add("Debasement Hedge");
    t.add("Scarcity / Real Assets");
  }
  if (/[çc]ekirdek|core|e[şs]it a[ğg][ıi]rl/.test(c) || k === "RSP")
    t.add("De-concentration");
  if (/geli[şs]en|emerging/.test(c) || k === "EMXC" || k === "KWEB") t.add("EM / Weak USD");
  if (/t[üu]rkiye|turkey/.test(c)) t.add("Turkey / TRY Carry");
  if (assetClass === "Cash") t.add("Real Carry");
  if (assetClass === "Unallocated") t.add("Dry Powder");
  if (/avrupa|europe/.test(c)) t.add("Europe Capex Cycle");
  return [...t];
}

// ---------------------------------------------------------------- factor model

/**
 * Factor loadings drive the model-implied covariance fallback used when there
 * is not enough real price history. Factors are treated as independent and
 * unit-variance.
 */
export const FACTORS = [
  "USEQ",
  "GLEQ",
  "EM",
  "TRY",
  "GOLD",
  "INDMET",
  "RATES",
  "TECH",
] as const;
export type Factor = (typeof FACTORS)[number];

export type Loadings = Partial<Record<Factor, number>>;

const LOADINGS_BY_CODE: Record<string, Loadings> = {
  PPF: { TRY: 0.92, RATES: 0.12 },
  BIST: { TRY: 0.72, EM: 0.42, GLEQ: 0.22 },
  RSP: { USEQ: 0.95, TECH: 0.14 },
  QQQ: { USEQ: 0.84, TECH: 0.52 },
  SMH: { USEQ: 0.66, TECH: 0.78 },
  XLI: { USEQ: 0.86, INDMET: 0.26 },
  VGK: { GLEQ: 0.9, USEQ: 0.34 },
  KWEB: { EM: 0.6, TECH: 0.32 },
  EMXC: { EM: 0.9, GLEQ: 0.3 },
  GLDM: { GOLD: 0.95 },
  CPER: { INDMET: 0.95, EM: 0.2 },
  SGOV: { RATES: 0.12 },
};

/** Fallback loadings for tickers we have never seen, keyed off asset class. */
const LOADINGS_BY_CLASS: Record<AssetClass, Loadings> = {
  Equity: { USEQ: 0.7, GLEQ: 0.4 },
  Commodity: { INDMET: 0.5, GOLD: 0.4 },
  Cash: { RATES: 0.15 },
  Alternative: { RATES: 0.2, INDMET: 0.2, GLEQ: 0.2 },
  Unallocated: { RATES: 0.12 },
};

export function loadingsFor(code: string, assetClass: AssetClass): Loadings {
  return (
    LOADINGS_BY_CODE[code.toLocaleUpperCase("tr")] ??
    LOADINGS_BY_CLASS[assetClass] ??
    LOADINGS_BY_CLASS.Equity
  );
}

/** Share of variance explained by factors (rest is idiosyncratic). */
export function systematicShare(assetClass: AssetClass): number {
  switch (assetClass) {
    case "Cash":
      return 0.9;
    case "Commodity":
      return 0.55;
    case "Unallocated":
      return 0.9;
    default:
      return 0.72;
  }
}

// ---------------------------------------------------------------- market monitor

export interface MarketInstrument {
  key: string;
  label: string;
  symbol: string;
  kind: "index" | "fx" | "rate" | "commodity" | "vol";
  /** Provider coverage for some of these is plan-dependent. */
  isProxy?: boolean;
  proxyNote?: string;
  invertForRiskOn?: boolean;
  decimals: number;
}

export const MARKET_INSTRUMENTS: MarketInstrument[] = [
  { key: "SPX", label: "S&P 500", symbol: "SPX", kind: "index", decimals: 2 },
  { key: "NDX", label: "Nasdaq 100", symbol: "NDX", kind: "index", decimals: 2 },
  { key: "XU100", label: "BIST 100", symbol: "XU100", kind: "index", decimals: 2 },
  {
    key: "DXY",
    label: "Dollar Index",
    symbol: "DXY",
    kind: "fx",
    invertForRiskOn: true,
    decimals: 2,
  },
  { key: "USDTRY", label: "USD/TRY", symbol: "USD/TRY", kind: "fx", decimals: 4 },
  { key: "EURUSD", label: "EUR/USD", symbol: "EUR/USD", kind: "fx", decimals: 4 },
  {
    key: "US2Y",
    label: "US 2Y Yield",
    symbol: "US2Y",
    kind: "rate",
    isProxy: true,
    proxyNote: "Treasury yields are not on every plan; shows UNAVAILABLE if none carries them.",
    decimals: 3,
  },
  {
    key: "US10Y",
    label: "US 10Y Yield",
    symbol: "US10Y",
    kind: "rate",
    isProxy: true,
    proxyNote: "Treasury yields are not on every plan; shows UNAVAILABLE if none carries them.",
    decimals: 3,
  },
  {
    key: "VIX",
    label: "VIX",
    symbol: "VIX",
    kind: "vol",
    invertForRiskOn: true,
    decimals: 2,
  },
  { key: "GOLD", label: "Gold", symbol: "XAU/USD", kind: "commodity", decimals: 2 },
  {
    key: "COPPER",
    label: "Copper",
    symbol: "CPER",
    kind: "commodity",
    isProxy: true,
    proxyNote: "Copper futures need a futures entitlement; CPER (ETF) is used as proxy.",
    decimals: 2,
  },
  { key: "WTI", label: "WTI Crude", symbol: "WTI/USD", kind: "commodity", decimals: 2 },
];

/** Annualised factor volatilities for the model-implied covariance fallback. */
export const FACTOR_VOL: Record<Factor, number> = {
  USEQ: 0.16,
  GLEQ: 0.17,
  EM: 0.19,
  TRY: 0.14,
  GOLD: 0.15,
  INDMET: 0.24,
  RATES: 0.06,
  TECH: 0.26,
};

export const RISK_FREE_RATE = 0.036;
export const TRADING_DAYS = 252;
