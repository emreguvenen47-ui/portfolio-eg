import type { Candle, Quote } from "@/lib/types";
import type { FinancialPeriod, KeyMetrics, Recommendation } from "@/lib/providers/fundamentals";
import { netCash, roic, totalDebt, ttmGrowth } from "./statements";
import { companyKind, suppressedMetrics, metricKey, SUPPRESSION_REASON } from "./company-kind";
import { analyseAnalysts } from "./analysts";
import { scoreQuality } from "@/lib/portfolio/quality-score";

/**
 * Side-by-side comparison.
 *
 * Two rules do the work here. First, a metric that is not economically
 * meaningful for a given company is N/A for that column rather than computed —
 * comparing a bank's gross margin against a chipmaker's is not a comparison,
 * it is a category error. Second, BEST/WEAK is only awarded when at least
 * three columns have real values and the winner is not tied, so a two-name
 * comparison with one blank does not crown anything.
 */

export type Rank = "BEST" | "STRONG" | "WEAK" | null;

export interface CompareCell {
  value: number | null;
  display: string;
  rank: Rank;
  /** Set when the metric does not apply to this company. */
  notApplicable?: string;
}

export interface CompareRow {
  key: string;
  label: string;
  /** Which direction is better; null means neither. */
  polarity: "higher" | "lower" | null;
  cells: CompareCell[];
  group: string;
}

export interface CompareInput {
  symbol: string;
  quote: Quote | null;
  candles: Candle[];
  periods: FinancialPeriod[];
  metrics: KeyMetrics | null;
  recommendations: Recommendation[] | null;
  technical: "BULLISH" | "NEUTRAL" | "BEARISH" | null;
  insiderSignal: string | null;
  smartMoney: number | null;
  opportunityScore: number | null;
  nextCatalyst: string | null;
}

const num = (v: number | string | undefined | null): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const ratioPct = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : (a / b) * 100;

const ttm = (periods: FinancialPeriod[], f: (p: FinancialPeriod) => number | null): number | null => {
  const w = periods.slice(-4);
  if (w.length < 4) return null;
  return w.reduce<number | null>((s, p) => {
    const v = f(p);
    return s === null || v === null ? null : s + v;
  }, 0);
};

const fmt = (v: number | null, kind: "pct" | "x" | "usd" | "num"): string => {
  if (v === null) return "N/A";
  if (kind === "pct") return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
  if (kind === "x") return `${v.toFixed(2)}×`;
  if (kind === "usd") {
    const a = Math.abs(v);
    const sign = v < 0 ? "-" : "";
    if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`;
    if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(0)}M`;
    return `${sign}$${a.toFixed(0)}`;
  }
  return v.toFixed(2);
};

/** Price return over the trailing n bars. Null when the series is too short. */
function priceReturn(candles: Candle[], bars: number): number | null {
  const closes = candles.map((c) => c.close).filter((c) => Number.isFinite(c) && c > 0);
  if (closes.length <= bars) return null;
  const ref = closes[closes.length - 1 - bars];
  return ref > 0 ? (closes.at(-1)! / ref - 1) * 100 : null;
}

interface Spec {
  key: string;
  label: string;
  group: string;
  polarity: "higher" | "lower" | null;
  kind: "pct" | "x" | "usd" | "num";
  /** Metric id checked against the company's suppression set. */
  applies?: string;
  get: (c: CompareInput) => number | null;
}

const SPECS: Spec[] = [
  // --- performance
  { key: "r1m", label: "1M Return", group: "Performance", polarity: "higher", kind: "pct", get: (c) => priceReturn(c.candles, 22) },
  { key: "r6m", label: "6M Return", group: "Performance", polarity: "higher", kind: "pct", get: (c) => priceReturn(c.candles, 128) },
  { key: "r1y", label: "1Y Return", group: "Performance", polarity: "higher", kind: "pct", get: (c) => priceReturn(c.candles, 253) },

  // --- growth
  { key: "revGrowth", label: "Revenue Growth YoY", group: "Growth", polarity: "higher", kind: "pct", get: (c) => ttmGrowth(c.periods, (p) => p.revenue) ?? num(c.metrics?.revenueGrowthTTMYoy) },
  { key: "epsGrowth", label: "EPS Growth YoY", group: "Growth", polarity: "higher", kind: "pct", get: (c) => ttmGrowth(c.periods, (p) => p.eps) ?? num(c.metrics?.epsGrowthTTMYoy) },

  // --- margins
  { key: "grossMargin", label: "Gross Margin", group: "Margins", polarity: "higher", kind: "pct", applies: "grossmargin", get: (c) => num(c.metrics?.grossMarginTTM) ?? ratioPct(ttm(c.periods, (p) => p.grossProfit), ttm(c.periods, (p) => p.revenue)) },
  { key: "operatingMargin", label: "Operating Margin", group: "Margins", polarity: "higher", kind: "pct", get: (c) => num(c.metrics?.operatingMarginTTM) ?? ratioPct(ttm(c.periods, (p) => p.operatingIncome), ttm(c.periods, (p) => p.revenue)) },
  { key: "fcfMargin", label: "FCF Margin", group: "Margins", polarity: "higher", kind: "pct", applies: "fcfmargin", get: (c) => ratioPct(ttm(c.periods, (p) => p.freeCashFlow), ttm(c.periods, (p) => p.revenue)) },

  // --- returns
  { key: "roe", label: "ROE", group: "Returns", polarity: "higher", kind: "pct", get: (c) => num(c.metrics?.roeTTM) },
  { key: "roic", label: "ROIC", group: "Returns", polarity: "higher", kind: "pct", applies: "roic", get: (c) => { const last = c.periods.at(-1); return last ? roic(last, c.periods) : null; } },

  // --- balance sheet
  { key: "netDebt", label: "Net Cash / (Debt)", group: "Balance Sheet", polarity: "higher", kind: "usd", applies: "netdebt", get: (c) => { const last = c.periods.at(-1); return last ? netCash(last) : null; } },
  { key: "debtEquity", label: "Debt / Equity", group: "Balance Sheet", polarity: "lower", kind: "x", applies: "debttoequity", get: (c) => num(c.metrics?.["totalDebt/totalEquityQuarterly"]) },

  // --- valuation
  { key: "pe", label: "P/E (TTM)", group: "Valuation", polarity: "lower", kind: "x", get: (c) => num(c.metrics?.peTTM) },
  { key: "forwardPe", label: "Forward P/E", group: "Valuation", polarity: "lower", kind: "x", get: (c) => num(c.metrics?.forwardPE) },
  { key: "peg", label: "PEG", group: "Valuation", polarity: "lower", kind: "x", get: (c) => num(c.metrics?.pegTTM) ?? num(c.metrics?.forwardPEG) },
  { key: "evEbitda", label: "EV/EBITDA", group: "Valuation", polarity: "lower", kind: "x", applies: "evebitda", get: (c) => num(c.metrics?.evEbitdaTTM) },
  { key: "pb", label: "P/B", group: "Valuation", polarity: "lower", kind: "x", get: (c) => num(c.metrics?.pbQuarterly) },

  // --- scores
  { key: "quality", label: "Financial Quality", group: "Scores", polarity: "higher", kind: "num", get: (c) => scoreQuality(c.metrics).total },
  { key: "smart", label: "Smart Money", group: "Scores", polarity: "higher", kind: "num", get: (c) => c.smartMoney },
  { key: "opportunity", label: "Opportunity Score", group: "Scores", polarity: "higher", kind: "num", get: (c) => c.opportunityScore },
];

/** Rows whose value is a label rather than a number. */
const TEXT_SPECS: { key: string; label: string; group: string; get: (c: CompareInput) => string }[] = [
  {
    key: "consensus",
    label: "Analyst Consensus",
    group: "Signals",
    get: (c) => analyseAnalysts(c.recommendations).label,
  },
  { key: "insider", label: "Insider Signal", group: "Signals", get: (c) => c.insiderSignal ?? "N/A" },
  { key: "technical", label: "Technical", group: "Signals", get: (c) => c.technical ?? "N/A" },
  { key: "catalyst", label: "Next Catalyst", group: "Signals", get: (c) => c.nextCatalyst ?? "N/A" },
];

export interface CompareResult {
  symbols: string[];
  rows: CompareRow[];
  textRows: { key: string; label: string; group: string; values: string[] }[];
}

/**
 * Rank a row.
 *
 * Only ranks when three or more columns carry a real value: with two, "BEST"
 * is just "the other one is worse", which the numbers already say. Ties are
 * left unranked rather than arbitrarily broken.
 */
function rankRow(values: (number | null)[], polarity: "higher" | "lower" | null): Rank[] {
  const present = values.filter((v): v is number => v !== null);
  if (polarity === null || present.length < 3) return values.map(() => null);

  const sorted = [...present].sort((a, b) => (polarity === "higher" ? b - a : a - b));
  const best = sorted[0];
  const worst = sorted.at(-1)!;
  if (best === worst) return values.map(() => null);

  return values.map((v) => {
    if (v === null) return null;
    if (v === best) return "BEST";
    if (v === worst) return "WEAK";
    // Second place in a field of four or more is worth naming; in a field of
    // three, "STRONG" for the middle value says nothing.
    if (present.length >= 4 && v === sorted[1]) return "STRONG";
    return null;
  });
}

export function compare(inputs: CompareInput[]): CompareResult {
  const kinds = inputs.map((i) => companyKind(i.symbol));
  const suppressed = kinds.map((k) => suppressedMetrics(k));

  const rows: CompareRow[] = SPECS.map((spec) => {
    const cells: CompareCell[] = inputs.map((input, i) => {
      const na = spec.applies !== undefined && suppressed[i].has(metricKey(spec.applies));
      if (na) {
        return {
          value: null,
          display: "N/A",
          rank: null,
          notApplicable: SUPPRESSION_REASON[kinds[i]],
        };
      }
      const v = spec.get(input);
      return { value: v, display: fmt(v, spec.kind), rank: null };
    });

    // Companies for which the metric does not apply are excluded from ranking
    // entirely, so a bank's blank gross margin cannot make a chipmaker "BEST"
    // by default.
    const ranks = rankRow(
      cells.map((c) => (c.notApplicable ? null : c.value)),
      spec.polarity,
    );
    ranks.forEach((r, i) => {
      cells[i].rank = r;
    });

    return { key: spec.key, label: spec.label, polarity: spec.polarity, cells, group: spec.group };
  });

  return {
    symbols: inputs.map((i) => i.symbol),
    rows,
    textRows: TEXT_SPECS.map((t) => ({
      key: t.key,
      label: t.label,
      group: t.group,
      values: inputs.map(t.get),
    })),
  };
}

export const COMPARE_GROUPS = [
  "Performance",
  "Growth",
  "Margins",
  "Returns",
  "Balance Sheet",
  "Valuation",
  "Scores",
  "Signals",
];
