import type { FinancialPeriod, KeyMetrics } from "@/lib/providers/fundamentals";
import {
  bankMetrics,
  companyKind,
  suppressedMetrics,
  metricKey,
  SUPPRESSION_REASON,
  BANK_GAP_NOTE,
} from "./company-kind";

/**
 * Derived views over reported financial statements.
 *
 * Everything here is arithmetic on filed figures. Nothing is estimated: a
 * metric whose inputs are missing comes back null and renders as N/A, because
 * a plausible-looking margin computed from a guessed denominator is worse than
 * a blank.
 */

export type Direction = "up" | "flat" | "down";

export interface MetricRow {
  key: string;
  label: string;
  /** Most recent reported value. */
  latest: number | null;
  qoq: number | null;
  yoy: number | null;
  /** Oldest → newest, for the sparkline. Nulls are gaps, not zeros. */
  series: (number | null)[];
  /** Whether the change is good, neutral or bad — metric-specific. */
  direction: Direction;
  format: "usd" | "pct" | "num" | "x";
}

const pct = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100;

const ratio = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : (a / b) * 100;

/** Periods oldest → newest, capped at `n`. */
export function ordered(periods: FinancialPeriod[], n = 8): FinancialPeriod[] {
  return periods.filter((p) => p.discrete).slice(0, n).reverse();
}

export const totalDebt = (p: FinancialPeriod): number | null =>
  p.shortTermDebt === null && p.longTermDebt === null
    ? null
    : (p.shortTermDebt ?? 0) + (p.longTermDebt ?? 0);

export const netCash = (p: FinancialPeriod): number | null => {
  const debt = totalDebt(p);
  if (debt === null) return null;
  const liquid = (p.cash ?? 0) + (p.shortTermInvestments ?? 0);
  return p.cash === null ? null : liquid - debt;
};

/**
 * Return on invested capital, computed from reported lines only.
 *
 * NOPAT over (equity + total debt − cash). Requires pretax income, tax, equity
 * and a debt figure; if any is missing the answer is null rather than a
 * partial formula dressed up as ROIC.
 */
export function roic(p: FinancialPeriod, trailing: FinancialPeriod[]): number | null {
  const debt = totalDebt(p);
  if (p.equity === null || debt === null) return null;

  // Use four quarters of operating income so the figure is annual, not a
  // quarter annualised by multiplying by four.
  const window = trailing.slice(-4);
  if (window.length < 4) return null;
  const ebit = window.reduce<number | null>(
    (s, q) => (s === null || q.operatingIncome === null ? null : s + q.operatingIncome),
    0,
  );
  if (ebit === null) return null;

  const tax = window.reduce<number | null>(
    (s, q) => (s === null || q.taxExpense === null ? null : s + q.taxExpense),
    0,
  );
  const pretax = window.reduce<number | null>(
    (s, q) => (s === null || q.pretaxIncome === null ? null : s + q.pretaxIncome),
    0,
  );
  const taxRate = tax !== null && pretax !== null && pretax > 0 ? Math.min(0.5, tax / pretax) : null;
  if (taxRate === null) return null;

  const invested = p.equity + debt - (p.cash ?? 0);
  if (invested <= 0) return null;
  return ((ebit * (1 - taxRate)) / invested) * 100;
}

/** Direction rules are metric-specific: rising debt is not rising revenue. */
type Polarity = "higher-better" | "lower-better" | "neutral";

function directionOf(change: number | null, polarity: Polarity, band: number): Direction {
  if (change === null || polarity === "neutral") return "flat";
  if (Math.abs(change) < band) return "flat";
  const good = polarity === "higher-better" ? change > 0 : change < 0;
  return good ? "up" : "down";
}

interface Spec {
  key: string;
  label: string;
  pick: (p: FinancialPeriod) => number | null;
  format: MetricRow["format"];
  polarity: Polarity;
  /** Changes smaller than this (in the metric's own units) read as flat. */
  band?: number;
  /** Margins compare in percentage points, not percent change. */
  pointChange?: boolean;
}

const INCOME_SPECS: Spec[] = [
  { key: "revenue", label: "Revenue", pick: (p) => p.revenue, format: "usd", polarity: "higher-better", band: 1 },
  { key: "grossProfit", label: "Gross Profit", pick: (p) => p.grossProfit, format: "usd", polarity: "higher-better", band: 1 },
  { key: "operatingIncome", label: "Operating Income", pick: (p) => p.operatingIncome, format: "usd", polarity: "higher-better", band: 1 },
  { key: "netIncome", label: "Net Income", pick: (p) => p.netIncome, format: "usd", polarity: "higher-better", band: 1 },
  { key: "eps", label: "EPS (diluted)", pick: (p) => p.eps, format: "num", polarity: "higher-better", band: 1 },
  { key: "operatingCashFlow", label: "Operating Cash Flow", pick: (p) => p.operatingCashFlow, format: "usd", polarity: "higher-better", band: 2 },
  { key: "freeCashFlow", label: "Free Cash Flow", pick: (p) => p.freeCashFlow, format: "usd", polarity: "higher-better", band: 2 },
];

const MARGIN_SPECS: Spec[] = [
  { key: "grossMargin", label: "Gross Margin", pick: (p) => ratio(p.grossProfit, p.revenue), format: "pct", polarity: "higher-better", band: 0.3, pointChange: true },
  { key: "operatingMargin", label: "Operating Margin", pick: (p) => ratio(p.operatingIncome, p.revenue), format: "pct", polarity: "higher-better", band: 0.3, pointChange: true },
  { key: "netMargin", label: "Net Margin", pick: (p) => ratio(p.netIncome, p.revenue), format: "pct", polarity: "higher-better", band: 0.3, pointChange: true },
  { key: "fcfMargin", label: "FCF Margin", pick: (p) => ratio(p.freeCashFlow, p.revenue), format: "pct", polarity: "higher-better", band: 0.5, pointChange: true },
];

function buildRow(spec: Spec, periods: FinancialPeriod[]): MetricRow {
  const series = periods.map(spec.pick);
  const latest = series.at(-1) ?? null;
  const prior = series.length >= 2 ? series[series.length - 2] : null;
  // Year-ago is four quarters back for a quarterly series, one step for annual.
  const yearAgo = series.length >= 5 ? series[series.length - 5] : null;

  const qoq = spec.pointChange
    ? latest !== null && prior !== null
      ? latest - prior
      : null
    : pct(latest, prior);
  const yoy = spec.pointChange
    ? latest !== null && yearAgo !== null
      ? latest - yearAgo
      : null
    : pct(latest, yearAgo);

  return {
    key: spec.key,
    label: spec.label,
    latest,
    qoq,
    yoy,
    series,
    direction: directionOf(yoy ?? qoq, spec.polarity, spec.band ?? 1),
    format: spec.format,
  };
}

export interface TrendReport {
  metrics: MetricRow[];
  margins: MetricRow[];
  /** Deterministic observations, e.g. "Revenue growth accelerating". */
  observations: { text: string; tone: "pos" | "neg" | "flat" }[];
  periodLabels: string[];
}

const label = (p: FinancialPeriod) =>
  p.quarter === 0 ? `FY${p.year}` : `${p.year} Q${p.quarter}`;

export function buildTrends(periods: FinancialPeriod[]): TrendReport {
  const ps = periods;
  const metrics = INCOME_SPECS.map((s) => buildRow(s, ps));
  const margins = MARGIN_SPECS.map((s) => buildRow(s, ps));
  return {
    metrics,
    margins,
    observations: observe(ps, metrics, margins),
    periodLabels: ps.map(label),
  };
}

/**
 * Deterministic trend statements.
 *
 * Each is a plain comparison over reported figures — no scoring, no model.
 * They exist so the numbers above them have a reading attached.
 */
function observe(
  ps: FinancialPeriod[],
  metrics: MetricRow[],
  margins: MetricRow[],
): { text: string; tone: "pos" | "neg" | "flat" }[] {
  const out: { text: string; tone: "pos" | "neg" | "flat" }[] = [];
  const by = (k: string) => [...metrics, ...margins].find((m) => m.key === k);

  // Growth acceleration compares the latest YoY rate with the prior period's.
  const rev = ps.map((p) => p.revenue);
  if (rev.length >= 6) {
    const now = pct(rev.at(-1)!, rev.at(-5) ?? null);
    const before = pct(rev.at(-2) ?? null, rev.at(-6) ?? null);
    if (now !== null && before !== null) {
      const delta = now - before;
      if (delta > 2) out.push({ text: `Revenue growth accelerating (${before.toFixed(1)}% → ${now.toFixed(1)}% YoY)`, tone: "pos" });
      else if (delta < -2) out.push({ text: `Revenue growth slowing (${before.toFixed(1)}% → ${now.toFixed(1)}% YoY)`, tone: "neg" });
    }
  }

  const gm = by("grossMargin");
  if (gm?.yoy !== null && gm?.yoy !== undefined) {
    const bps = Math.round(gm.yoy * 100);
    if (bps >= 50) out.push({ text: `Gross margin expanded ${bps}bps YoY`, tone: "pos" });
    else if (bps <= -50) out.push({ text: `Gross margin compressed ${Math.abs(bps)}bps YoY`, tone: "neg" });
  }

  const om = by("operatingMargin");
  if (om?.yoy !== null && om?.yoy !== undefined) {
    const bps = Math.round(om.yoy * 100);
    if (bps >= 50) out.push({ text: `Operating margin expanded ${bps}bps YoY`, tone: "pos" });
    else if (bps <= -50) out.push({ text: `Operating margin compressed ${Math.abs(bps)}bps YoY`, tone: "neg" });
  }

  const fcf = by("freeCashFlow");
  if (fcf?.yoy !== null && fcf?.yoy !== undefined) {
    if (fcf.yoy >= 10) out.push({ text: `Free cash flow improving (+${fcf.yoy.toFixed(0)}% YoY)`, tone: "pos" });
    else if (fcf.yoy <= -10) out.push({ text: `Free cash flow deteriorating (${fcf.yoy.toFixed(0)}% YoY)`, tone: "neg" });
  }

  // Three consecutive quarters of decelerating growth is the pattern worth
  // naming; one soft quarter is noise.
  if (rev.length >= 8) {
    const rates = [0, 1, 2].map((i) =>
      pct(rev[rev.length - 1 - i] ?? null, rev[rev.length - 5 - i] ?? null),
    );
    if (rates.every((r) => r !== null) && rates[0]! < rates[1]! && rates[1]! < rates[2]!) {
      out.push({ text: "Revenue growth slowed for 3 consecutive quarters", tone: "neg" });
    }
  }

  const last = ps.at(-1);
  const yearAgoP = ps.length >= 5 ? ps[ps.length - 5] : null;
  if (last && yearAgoP) {
    const d0 = totalDebt(last);
    const d1 = totalDebt(yearAgoP);
    const dc = pct(d0, d1);
    if (dc !== null && dc >= 10) out.push({ text: `Total debt rose ${dc.toFixed(0)}% YoY`, tone: "neg" });
    else if (dc !== null && dc <= -10) out.push({ text: `Total debt reduced ${Math.abs(dc).toFixed(0)}% YoY`, tone: "pos" });

    const nc = netCash(last);
    if (nc !== null && nc > 0) out.push({ text: "Net cash balance sheet", tone: "pos" });

    const cashChange = pct(last.cash, yearAgoP.cash);
    if (cashChange !== null && cashChange >= 15) {
      out.push({ text: `Cash position strengthening (+${cashChange.toFixed(0)}% YoY)`, tone: "pos" });
    }
  }

  return out;
}

// ------------------------------------------------------------ earnings quality

export interface EarningsQuality {
  netIncome: number | null;
  operatingCashFlow: number | null;
  freeCashFlow: number | null;
  ocfToNi: number | null;
  fcfToNi: number | null;
  verdict: "HIGH QUALITY" | "ADEQUATE" | "WATCH" | "N/A";
  note: string;
}

/**
 * Compare accounting earnings with the cash actually generated.
 *
 * Sustained cash conversion below reported profit is worth flagging, but the
 * language stays descriptive: this is an observation about two reported
 * numbers diverging, not an accusation about how they were produced.
 */
export function earningsQuality(periods: FinancialPeriod[]): EarningsQuality {
  const window = periods.slice(-4);
  const sum = (f: (p: FinancialPeriod) => number | null): number | null =>
    window.reduce<number | null>((s, p) => {
      const v = f(p);
      return s === null || v === null ? null : s + v;
    }, 0);

  const ni = sum((p) => p.netIncome);
  const ocf = sum((p) => p.operatingCashFlow);
  const fcf = sum((p) => p.freeCashFlow);
  const ocfToNi = ni !== null && ni > 0 && ocf !== null ? ocf / ni : null;
  const fcfToNi = ni !== null && ni > 0 && fcf !== null ? fcf / ni : null;

  if (window.length < 4 || ocfToNi === null) {
    return {
      netIncome: ni,
      operatingCashFlow: ocf,
      freeCashFlow: fcf,
      ocfToNi,
      fcfToNi,
      verdict: "N/A",
      note: "Not enough reported quarters to compare earnings with cash generation.",
    };
  }

  // Is net income rising while cash generation falls? That divergence is the
  // thing worth surfacing, more than any single-period ratio.
  const half = Math.floor(window.length / 2);
  const older = window.slice(0, half);
  const newer = window.slice(half);
  const avg = (xs: FinancialPeriod[], f: (p: FinancialPeriod) => number | null) => {
    const vs = xs.map(f).filter((v): v is number => v !== null);
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  };
  const niTrend = pct(avg(newer, (p) => p.netIncome), avg(older, (p) => p.netIncome));
  const ocfTrend = pct(avg(newer, (p) => p.operatingCashFlow), avg(older, (p) => p.operatingCashFlow));
  const diverging = niTrend !== null && ocfTrend !== null && niTrend > 5 && ocfTrend < -5;

  if (diverging) {
    return {
      netIncome: ni,
      operatingCashFlow: ocf,
      freeCashFlow: fcf,
      ocfToNi,
      fcfToNi,
      verdict: "WATCH",
      note: "Net income is rising while operating cash flow is falling over the same period. Worth understanding before treating reported profit growth as cash generation.",
    };
  }
  if (ocfToNi >= 1.1) {
    return {
      netIncome: ni,
      operatingCashFlow: ocf,
      freeCashFlow: fcf,
      ocfToNi,
      fcfToNi,
      verdict: "HIGH QUALITY",
      note: `Operating cash flow is ${ocfToNi.toFixed(2)}× reported net income over the last four quarters — cash generation comfortably supports earnings.`,
    };
  }
  if (ocfToNi < 0.8) {
    return {
      netIncome: ni,
      operatingCashFlow: ocf,
      freeCashFlow: fcf,
      ocfToNi,
      fcfToNi,
      verdict: "WATCH",
      note: `Operating cash flow is only ${ocfToNi.toFixed(2)}× net income over four quarters. Reported profit is running ahead of cash collection.`,
    };
  }
  return {
    netIncome: ni,
    operatingCashFlow: ocf,
    freeCashFlow: fcf,
    ocfToNi,
    fcfToNi,
    verdict: "ADEQUATE",
    note: `Operating cash flow is ${ocfToNi.toFixed(2)}× net income over four quarters — broadly in line with reported earnings.`,
  };
}

// ---------------------------------------------------------- capital allocation

export interface CapitalAllocation {
  rows: {
    label: string;
    key: string;
    series: (number | null)[];
    latest: number | null;
    ttm: number | null;
  }[];
  shareCountYoY: number | null;
  shareVerdict: "NET BUYBACK" | "DILUTION" | "STABLE" | "N/A";
  periodLabels: string[];
}

export function capitalAllocation(periods: FinancialPeriod[]): CapitalAllocation {
  const specs: { key: string; label: string; pick: (p: FinancialPeriod) => number | null }[] = [
    { key: "capex", label: "CapEx", pick: (p) => (p.capex === null ? null : Math.abs(p.capex)) },
    { key: "dividends", label: "Dividends Paid", pick: (p) => (p.dividendsPaid === null ? null : Math.abs(p.dividendsPaid)) },
    { key: "buybacks", label: "Share Repurchases", pick: (p) => (p.buybacks === null ? null : Math.abs(p.buybacks)) },
    { key: "issuance", label: "Share Issuance", pick: (p) => p.stockIssued },
    { key: "debtIssued", label: "Debt Issued", pick: (p) => p.debtIssued },
    { key: "debtRepaid", label: "Debt Repaid", pick: (p) => (p.debtRepaid === null ? null : Math.abs(p.debtRepaid)) },
  ];

  const rows = specs.map((s) => {
    const series = periods.map(s.pick);
    const last4 = series.slice(-4);
    const ttm = last4.every((v) => v !== null)
      ? (last4 as number[]).reduce((a, b) => a + b, 0)
      : null;
    return { key: s.key, label: s.label, series, latest: series.at(-1) ?? null, ttm };
  });

  // Share count change is what actually reaches a per-share return, so it is
  // measured directly from the diluted count rather than inferred from the
  // dollars spent on buybacks.
  const shares = periods.map((p) => p.dilutedShares);
  const now = shares.at(-1) ?? null;
  const yearAgo = shares.length >= 5 ? shares[shares.length - 5] : null;
  const shareCountYoY = pct(now, yearAgo);

  return {
    rows,
    shareCountYoY,
    shareVerdict:
      shareCountYoY === null
        ? "N/A"
        : shareCountYoY <= -1
          ? "NET BUYBACK"
          : shareCountYoY >= 1
            ? "DILUTION"
            : "STABLE",
    periodLabels: periods.map(label),
  };
}

// -------------------------------------------------------------- overview grid

export interface OverviewMetric {
  label: string;
  value: number | null;
  format: MetricRow["format"];
  hint?: string;
}

export interface OverviewSection {
  title: string;
  items: OverviewMetric[];
}

/**
 * The overview grid, assembled from filings first and the metric bag second.
 *
 * Where both have a figure the filed one wins: it is the number the company
 * reported, on a period we can name.
 */
export function overview(
  periods: FinancialPeriod[],
  m: KeyMetrics | null,
  symbol = "",
): OverviewSection[] {
  const kind = companyKind(symbol);
  if (kind === "bank" || kind === "insurer") return bankOverview(periods, m, kind);
  return operatingOverview(periods, m, kind);
}

/**
 * Bank and insurer overview.
 *
 * A separate grid rather than the industrial one with holes punched in it:
 * the metrics that matter for a balance-sheet business — return on equity,
 * book value, price to book, equity funding — are not a subset of the
 * industrial set, so filtering would leave a thin, uninformative page.
 */
function bankOverview(
  periods: FinancialPeriod[],
  m: KeyMetrics | null,
  kind: "bank" | "insurer",
): OverviewSection[] {
  const b = bankMetrics(m, periods);
  const num = (v: number | string | undefined): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const last = periods.at(-1) ?? null;

  return [
    {
      title: "Earnings",
      items: [
        { label: "Net Income (TTM)", value: b.netIncome, format: "usd" },
        { label: "Net Income Growth YoY", value: b.netIncomeGrowth, format: "pct" },
        { label: "EPS (TTM)", value: ttmOf(periods, (p) => p.eps), format: "num" },
        { label: "Revenue (TTM)", value: ttmOf(periods, (p) => p.revenue), format: "usd", hint: "Revenue net of interest expense where the filer reports it that way." },
      ],
    },
    {
      title: "Returns",
      items: [
        { label: "ROE", value: b.roe, format: "pct", hint: "The headline profitability measure for a balance-sheet business." },
        { label: "ROA", value: b.roa, format: "pct" },
      ],
    },
    {
      title: "Balance Sheet",
      items: [
        { label: "Total Assets", value: b.totalAssets, format: "usd" },
        { label: "Shareholders' Equity", value: b.equity, format: "usd" },
        {
          label: "Equity / Assets",
          value: b.equityToAssets,
          format: "pct",
          hint: "A simple leverage read from reported statements. NOT a regulatory capital adequacy ratio.",
        },
      ],
    },
    {
      title: "Valuation",
      items: [
        { label: "P/B", value: b.priceToBook, format: "x", hint: "The primary valuation anchor for banks." },
        { label: "Book Value per Share", value: b.bookValuePerShare, format: "num" },
        { label: "P/E (TTM)", value: num(m?.peTTM), format: "x" },
        { label: "Dividend Yield", value: num(m?.dividendYieldIndicatedAnnual), format: "pct" },
      ],
    },
    {
      title: "Regulatory",
      items: [
        { label: "Capital Adequacy", value: null, format: "pct", hint: BANK_GAP_NOTE },
        { label: "NPL Ratio", value: null, format: "pct", hint: BANK_GAP_NOTE },
        { label: "Net Interest Margin", value: null, format: "pct", hint: BANK_GAP_NOTE },
      ],
    },
    {
      title: "Not Applicable",
      items: [
        { label: "Gross Margin", value: null, format: "pct", hint: SUPPRESSION_REASON[kind] },
        { label: "Free Cash Flow", value: null, format: "usd", hint: SUPPRESSION_REASON[kind] },
        { label: "Net Debt", value: null, format: "usd", hint: SUPPRESSION_REASON[kind] },
        { label: "ROIC", value: null, format: "pct", hint: SUPPRESSION_REASON[kind] },
      ],
    },
  ];
}

function ttmOf(
  periods: FinancialPeriod[],
  f: (p: FinancialPeriod) => number | null,
): number | null {
  const w = periods.slice(-4);
  if (w.length < 4) return null;
  return w.reduce<number | null>((s, p) => {
    const v = f(p);
    return s === null || v === null ? null : s + v;
  }, 0);
}

function operatingOverview(
  periods: FinancialPeriod[],
  m: KeyMetrics | null,
  kind: ReturnType<typeof companyKind>,
): OverviewSection[] {
  const suppressed = suppressedMetrics(kind);
  const sections = buildOperatingOverview(periods, m);
  if (suppressed.size === 0) return sections;
  // A REIT keeps the industrial grid but with the misleading rows blanked and
  // a reason attached, rather than silently dropped.
  return sections.map((sec) => ({
    ...sec,
    items: sec.items.map((it) =>
      suppressed.has(keyOf(it.label))
        ? { ...it, value: null, hint: SUPPRESSION_REASON[kind] }
        : it,
    ),
  }));
}

const keyOf = metricKey;

function buildOperatingOverview(
  periods: FinancialPeriod[],
  m: KeyMetrics | null,
): OverviewSection[] {
  const last = periods.at(-1) ?? null;
  const yearAgo = periods.length >= 5 ? periods[periods.length - 5] : null;
  const num = (v: number | string | undefined): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const ttm = (f: (p: FinancialPeriod) => number | null): number | null => {
    const w = periods.slice(-4);
    if (w.length < 4) return null;
    return w.reduce<number | null>((s, p) => {
      const v = f(p);
      return s === null || v === null ? null : s + v;
    }, 0);
  };

  const ttmFcf = ttm((p) => p.freeCashFlow);
  const ttmNi = ttm((p) => p.netIncome);
  const ttmRev = ttm((p) => p.revenue);
  const debt = last ? totalDebt(last) : null;
  const nc = last ? netCash(last) : null;
  const shares = last?.dilutedShares ?? null;

  return [
    {
      title: "Growth",
      items: [
        { label: "Revenue (TTM)", value: ttmRev, format: "usd" },
        // Filings first, provider metric only as a fallback — see ttmGrowth.
        { label: "Revenue Growth YoY", value: ttmGrowth(periods, (p) => p.revenue) ?? num(m?.revenueGrowthTTMYoy), format: "pct", hint: "Trailing twelve months of filed revenue against the twelve before." },
        { label: "EPS (TTM)", value: ttm((p) => p.eps), format: "num" },
        { label: "EPS Growth YoY", value: ttmGrowth(periods, (p) => p.eps) ?? num(m?.epsGrowthTTMYoy), format: "pct" },
        { label: "FCF Growth YoY", value: ttmGrowth(periods, (p) => p.freeCashFlow), format: "pct" },
      ],
    },
    {
      title: "Profitability",
      items: [
        { label: "Gross Margin", value: num(m?.grossMarginTTM) ?? ratio(last?.grossProfit ?? null, last?.revenue ?? null), format: "pct" },
        { label: "Operating Margin", value: num(m?.operatingMarginTTM) ?? ratio(last?.operatingIncome ?? null, last?.revenue ?? null), format: "pct" },
        { label: "Net Margin", value: num(m?.netProfitMarginTTM) ?? ratio(last?.netIncome ?? null, last?.revenue ?? null), format: "pct" },
        { label: "FCF Margin", value: ratio(ttmFcf, ttmRev), format: "pct" },
      ],
    },
    {
      title: "Cash Generation",
      items: [
        { label: "Operating Cash Flow (TTM)", value: ttm((p) => p.operatingCashFlow), format: "usd" },
        { label: "Free Cash Flow (TTM)", value: ttmFcf, format: "usd" },
        { label: "FCF / Net Income", value: ttmNi !== null && ttmNi > 0 && ttmFcf !== null ? ttmFcf / ttmNi : null, format: "x", hint: "Above 1.0× means cash generation exceeds reported profit." },
      ],
    },
    {
      title: "Balance Sheet",
      items: [
        { label: "Cash & Equivalents", value: last?.cash ?? null, format: "usd" },
        { label: "Total Debt", value: debt, format: "usd" },
        { label: nc !== null && nc >= 0 ? "Net Cash" : "Net Debt", value: nc === null ? null : Math.abs(nc), format: "usd" },
        { label: "Debt / Equity", value: num(m?.["totalDebt/totalEquityQuarterly"]), format: "x" },
        { label: "Current Ratio", value: num(m?.currentRatioQuarterly) ?? (last ? ratioOf(last.currentAssets, last.currentLiabilities) : null), format: "x" },
      ],
    },
    {
      title: "Capital Efficiency",
      items: [
        { label: "ROE", value: num(m?.roeTTM), format: "pct" },
        { label: "ROA", value: num(m?.roaTTM), format: "pct" },
        { label: "ROIC", value: last ? roic(last, periods) : null, format: "pct", hint: "NOPAT ÷ (equity + debt − cash), from reported figures. Blank when any input is missing." },
      ],
    },
    {
      title: "Per Share",
      items: [
        { label: "EPS (TTM)", value: ttm((p) => p.eps), format: "num" },
        { label: "FCF per Share", value: ttmFcf !== null && shares ? ttmFcf / shares : null, format: "num" },
        { label: "Book Value per Share", value: num(m?.bookValuePerShareQuarterly), format: "num" },
      ],
    },
    {
      title: "Valuation",
      items: [
        { label: "P/E (TTM)", value: num(m?.peTTM), format: "x" },
        { label: "Forward P/E", value: num(m?.forwardPE), format: "x" },
        { label: "PEG", value: num(m?.pegTTM) ?? num(m?.forwardPEG), format: "x" },
        { label: "P/S", value: num(m?.psTTM), format: "x" },
        { label: "P/B", value: num(m?.pbQuarterly), format: "x" },
        { label: "EV/EBITDA", value: num(m?.evEbitdaTTM), format: "x" },
        { label: "FCF Yield", value: fcfYield(m), format: "pct", hint: "Inverted from EV/FCF where the provider carries it." },
      ],
    },
  ];
}

const ratioOf = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : a / b;

/**
 * Growth from the filings: trailing twelve months against the twelve before.
 *
 * Preferred over the provider's own growth metric, which is computed on a
 * revenue definition we cannot see and goes badly wrong for some filers — it
 * reports JPMorgan's revenue growth as +109% because it is measuring gross
 * interest income rather than revenue net of interest expense. Eight discrete
 * quarters of filed figures give a number whose derivation is visible in the
 * statements tab directly below it.
 */
export function ttmGrowth(
  periods: FinancialPeriod[],
  f: (p: FinancialPeriod) => number | null,
): number | null {
  const sum = (xs: FinancialPeriod[]): number | null =>
    xs.length < 4
      ? null
      : xs.reduce<number | null>((s, p) => {
          const v = f(p);
          return s === null || v === null ? null : s + v;
        }, 0);

  const now = sum(periods.slice(-4));
  const before = sum(periods.slice(-8, -4));
  if (now !== null && before !== null && before !== 0) {
    return ((now - before) / Math.abs(before)) * 100;
  }
  // Not enough history for a trailing comparison — fall back to the single
  // quarter against the same quarter a year earlier.
  const last = periods.at(-1) ?? null;
  const yearAgo = periods.length >= 5 ? periods[periods.length - 5] : null;
  return pct(last ? f(last) : null, yearAgo ? f(yearAgo) : null);
}

function fcfYield(m: KeyMetrics | null): number | null {
  const evFcf = m?.["currentEv/freeCashFlowTTM"];
  if (typeof evFcf === "number" && evFcf > 0) return (1 / evFcf) * 100;
  return null;
}
