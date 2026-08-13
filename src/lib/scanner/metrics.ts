import type { FinancialPeriod, KeyMetrics } from "@/lib/providers/fundamentals";
import type { Candle } from "@/lib/types";
import type { Sector } from "./universe";
import { netCash, roic, totalDebt, ttmGrowth } from "@/lib/research/statements";

/**
 * The metric set for one candidate, and which metrics its sector actually
 * cares about.
 *
 * The central rule: a metric that is not economically meaningful for a
 * business is absent, not zero and not penalised. A bank has no gross margin;
 * scoring it a zero there would rank every bank below every software company
 * for a reason that says nothing about either.
 */

export interface Facts {
  symbol: string;
  // growth
  revenueGrowth: number | null;
  epsGrowth: number | null;
  // profitability
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  fcfMargin: number | null;
  ruleOf40: number | null;
  // returns
  roe: number | null;
  roa: number | null;
  roic: number | null;
  // balance sheet
  netCashToAssets: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  equityToAssets: number | null;
  interestCover: number | null;
  // valuation (lower is cheaper)
  pe: number | null;
  forwardPe: number | null;
  ps: number | null;
  pb: number | null;
  evEbitda: number | null;
  evSales: number | null;
  pFcf: number | null;
  fcfYield: number | null;
  // momentum / risk
  return3m: number | null;
  return6m: number | null;
  return12m: number | null;
  fromHigh: number | null;
  volatility: number | null;
  beta: number | null;
  // sentiment
  analystScore: number | null;
  // supporting
  bookValueGrowth: number | null;
}

export type MetricKey = keyof Omit<Facts, "symbol">;

/** Whether a higher reading is better for ranking. */
export const HIGHER_IS_BETTER: Record<MetricKey, boolean> = {
  revenueGrowth: true,
  epsGrowth: true,
  grossMargin: true,
  operatingMargin: true,
  netMargin: true,
  fcfMargin: true,
  ruleOf40: true,
  roe: true,
  roa: true,
  roic: true,
  netCashToAssets: true,
  debtToEquity: false,
  currentRatio: true,
  equityToAssets: true,
  interestCover: true,
  pe: false,
  forwardPe: false,
  ps: false,
  pb: false,
  evEbitda: false,
  evSales: false,
  pFcf: false,
  fcfYield: true,
  return3m: true,
  return6m: true,
  return12m: true,
  fromHigh: true,
  volatility: false,
  beta: false,
  analystScore: true,
  bookValueGrowth: true,
};

export type Pillar =
  | "quality"
  | "growth"
  | "valuation"
  | "profitability"
  | "balanceSheet"
  | "momentum"
  | "sentiment"
  | "risk";

/**
 * Which metrics each sector is judged on, by pillar.
 *
 * Absent from a sector's list means the metric is not used for that sector at
 * all — not that it scores badly. Banks have no `grossMargin` entry anywhere,
 * so a bank is never compared on it.
 */
type SectorModel = Record<Pillar, MetricKey[]>;

const BASE_INDUSTRIAL: SectorModel = {
  quality: ["roic", "operatingMargin", "fcfMargin"],
  growth: ["revenueGrowth", "epsGrowth"],
  valuation: ["pe", "forwardPe", "evEbitda"],
  profitability: ["operatingMargin", "netMargin"],
  balanceSheet: ["debtToEquity", "currentRatio", "netCashToAssets", "interestCover"],
  momentum: ["return3m", "return6m", "return12m"],
  sentiment: ["analystScore"],
  risk: ["volatility", "beta"],
};

const MODELS: Record<Sector, SectorModel> = {
  Software: {
    quality: ["grossMargin", "fcfMargin", "ruleOf40"],
    growth: ["revenueGrowth", "epsGrowth"],
    // Software rarely has meaningful EBITDA early on; sales-based multiples
    // and cash flow are what the market actually prices.
    valuation: ["ps", "evSales", "pFcf", "forwardPe"],
    profitability: ["grossMargin", "operatingMargin", "fcfMargin"],
    balanceSheet: ["netCashToAssets", "currentRatio", "debtToEquity"],
    momentum: ["return3m", "return6m", "return12m"],
    sentiment: ["analystScore"],
    risk: ["volatility", "beta"],
  },
  Semiconductors: {
    quality: ["grossMargin", "roic", "fcfMargin"],
    growth: ["revenueGrowth", "epsGrowth"],
    valuation: ["pe", "forwardPe", "evEbitda"],
    profitability: ["grossMargin", "operatingMargin"],
    balanceSheet: ["netCashToAssets", "debtToEquity", "currentRatio"],
    momentum: ["return3m", "return6m", "return12m"],
    sentiment: ["analystScore"],
    risk: ["volatility", "beta"],
  },
  Technology: BASE_INDUSTRIAL,
  Banks: {
    // No gross margin, no free cash flow, no net debt — none of them describe
    // a balance-sheet business.
    quality: ["roe", "roa"],
    growth: ["epsGrowth", "bookValueGrowth"],
    valuation: ["pb", "pe"],
    profitability: ["roe", "roa", "netMargin"],
    balanceSheet: ["equityToAssets"],
    momentum: ["return3m", "return6m", "return12m"],
    sentiment: ["analystScore"],
    risk: ["volatility", "beta"],
  },
  Financials: {
    quality: ["roe", "roa"],
    growth: ["revenueGrowth", "epsGrowth", "bookValueGrowth"],
    valuation: ["pb", "pe"],
    profitability: ["roe", "netMargin"],
    balanceSheet: ["equityToAssets", "debtToEquity"],
    momentum: ["return3m", "return6m", "return12m"],
    sentiment: ["analystScore"],
    risk: ["volatility", "beta"],
  },
  Healthcare: {
    quality: ["grossMargin", "roic", "fcfMargin"],
    growth: ["revenueGrowth", "epsGrowth"],
    valuation: ["pe", "forwardPe", "evEbitda", "ps"],
    profitability: ["grossMargin", "operatingMargin", "netMargin"],
    balanceSheet: ["netCashToAssets", "currentRatio", "debtToEquity"],
    momentum: ["return3m", "return6m", "return12m"],
    sentiment: ["analystScore"],
    risk: ["volatility", "beta"],
  },
  Industrials: BASE_INDUSTRIAL,
  Energy: {
    // Cash generation and leverage dominate; earnings multiples swing with the
    // commodity and say little about the business.
    quality: ["fcfMargin", "roic"],
    growth: ["revenueGrowth"],
    valuation: ["evEbitda", "fcfYield", "pe"],
    profitability: ["operatingMargin", "netMargin"],
    balanceSheet: ["debtToEquity", "interestCover", "netCashToAssets"],
    momentum: ["return3m", "return6m", "return12m"],
    sentiment: ["analystScore"],
    risk: ["volatility", "beta"],
  },
  Consumer: {
    quality: ["roic", "grossMargin", "fcfMargin"],
    growth: ["revenueGrowth", "epsGrowth"],
    valuation: ["pe", "forwardPe", "evEbitda"],
    profitability: ["grossMargin", "operatingMargin", "netMargin"],
    balanceSheet: ["debtToEquity", "currentRatio", "interestCover"],
    momentum: ["return3m", "return6m", "return12m"],
    sentiment: ["analystScore"],
    risk: ["volatility", "beta"],
  },
  Materials: BASE_INDUSTRIAL,
  Utilities: {
    quality: ["roic", "operatingMargin"],
    growth: ["revenueGrowth", "epsGrowth"],
    valuation: ["pe", "evEbitda", "pb"],
    profitability: ["operatingMargin", "netMargin"],
    balanceSheet: ["debtToEquity", "interestCover"],
    momentum: ["return3m", "return6m", "return12m"],
    sentiment: ["analystScore"],
    risk: ["volatility", "beta"],
  },
  RealEstate: {
    // FFO and NAV are the right basis and no configured provider carries them,
    // so a REIT is scored on the few things that do survive and its coverage
    // reflects that rather than being padded with earnings multiples that
    // depreciation makes meaningless.
    quality: ["operatingMargin"],
    growth: ["revenueGrowth"],
    valuation: ["pb", "evEbitda"],
    profitability: ["operatingMargin"],
    balanceSheet: ["debtToEquity", "interestCover"],
    momentum: ["return3m", "return6m", "return12m"],
    sentiment: ["analystScore"],
    risk: ["volatility", "beta"],
  },
  Communication: BASE_INDUSTRIAL,
  Other: BASE_INDUSTRIAL,
};

export const modelFor = (sector: Sector): SectorModel => MODELS[sector] ?? BASE_INDUSTRIAL;

/** Every metric the sector uses, deduplicated. */
export function metricsUsedBy(sector: Sector): MetricKey[] {
  const m = modelFor(sector);
  return [...new Set(Object.values(m).flat())];
}

// ------------------------------------------------------------------ builders

const num = (v: number | string | undefined | null): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const ratioPct = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : (a / b) * 100;

const ttm = (ps: FinancialPeriod[], f: (p: FinancialPeriod) => number | null): number | null => {
  const w = ps.slice(-4);
  if (w.length < 4) return null;
  return w.reduce<number | null>((s, p) => {
    const v = f(p);
    return s === null || v === null ? null : s + v;
  }, 0);
};

function priceReturn(candles: Candle[], bars: number): number | null {
  const c = candles.map((x) => x.close).filter((x) => Number.isFinite(x) && x > 0);
  if (c.length <= bars) return null;
  const ref = c[c.length - 1 - bars];
  return ref > 0 ? (c.at(-1)! / ref - 1) * 100 : null;
}

function annualVol(candles: Candle[], period = 120): number | null {
  const c = candles.map((x) => x.close).filter((x) => Number.isFinite(x) && x > 0);
  if (c.length < period + 1) return null;
  const rets: number[] = [];
  for (let i = c.length - period; i < c.length; i++) rets.push(c[i] / c[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  return Math.sqrt(varr * 252) * 100;
}

export function buildFacts(input: {
  symbol: string;
  metrics: KeyMetrics | null;
  periods: FinancialPeriod[];
  candles: Candle[];
  analystScore: number | null;
}): Facts {
  const { symbol, metrics: m, periods, candles, analystScore } = input;
  const last = periods.at(-1) ?? null;

  const ttmRev = ttm(periods, (p) => p.revenue);
  const ttmFcf = ttm(periods, (p) => p.freeCashFlow);
  const revGrowth = ttmGrowth(periods, (p) => p.revenue) ?? num(m?.revenueGrowthTTMYoy);
  const fcfM = ratioPct(ttmFcf, ttmRev);

  // Rule of 40 only means anything when both legs exist.
  const ruleOf40 = revGrowth !== null && fcfM !== null ? revGrowth + fcfM : null;

  const nc = last ? netCash(last) : null;
  const debt = last ? totalDebt(last) : null;
  const closes = candles.map((c) => c.close).filter((c) => c > 0);
  const high52 = closes.length > 60 ? Math.max(...closes.slice(-253)) : null;
  const price = closes.at(-1) ?? null;

  const evFcf = num(m?.["currentEv/freeCashFlowTTM"]);

  return {
    symbol,
    revenueGrowth: revGrowth,
    epsGrowth: ttmGrowth(periods, (p) => p.eps) ?? num(m?.epsGrowthTTMYoy),
    grossMargin: num(m?.grossMarginTTM) ?? ratioPct(ttm(periods, (p) => p.grossProfit), ttmRev),
    operatingMargin:
      num(m?.operatingMarginTTM) ?? ratioPct(ttm(periods, (p) => p.operatingIncome), ttmRev),
    netMargin: num(m?.netProfitMarginTTM) ?? ratioPct(ttm(periods, (p) => p.netIncome), ttmRev),
    fcfMargin: fcfM,
    ruleOf40,
    roe:
      num(m?.roeTTM) ??
      (last?.equity ? ratioPct(ttm(periods, (p) => p.netIncome), last.equity) : null),
    roa:
      num(m?.roaTTM) ??
      (last?.totalAssets ? ratioPct(ttm(periods, (p) => p.netIncome), last.totalAssets) : null),
    roic: last ? roic(last, periods) : null,
    netCashToAssets:
      nc !== null && last?.totalAssets ? (nc / last.totalAssets) * 100 : null,
    debtToEquity:
      num(m?.["totalDebt/totalEquityQuarterly"]) ??
      (debt !== null && last?.equity ? (debt / last.equity) * 100 : null),
    currentRatio:
      num(m?.currentRatioQuarterly) ??
      (last?.currentAssets && last?.currentLiabilities
        ? last.currentAssets / last.currentLiabilities
        : null),
    equityToAssets:
      last?.equity != null && last?.totalAssets ? (last.equity / last.totalAssets) * 100 : null,
    interestCover: num(m?.netInterestCoverageTTM),
    pe: num(m?.peTTM),
    forwardPe: num(m?.forwardPE),
    ps: num(m?.psTTM),
    pb: num(m?.pbQuarterly),
    evEbitda: num(m?.evEbitdaTTM),
    evSales: num(m?.evRevenueTTM),
    pFcf: num(m?.pfcfShareTTM),
    fcfYield: evFcf !== null && evFcf > 0 ? (1 / evFcf) * 100 : null,
    return3m: priceReturn(candles, 64),
    return6m: priceReturn(candles, 128),
    return12m: priceReturn(candles, 253),
    fromHigh: price !== null && high52 ? (price / high52 - 1) * 100 : null,
    volatility: annualVol(candles),
    beta: num(m?.beta),
    analystScore,
    bookValueGrowth: null,
  };
}
