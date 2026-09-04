import type { CompanySnapshot } from "@/lib/data/normalize/company";
import { sumComplete, yoyGrowth } from "@/lib/data/normalize/company";
import { buildFinancialStory, type FinancialStory } from "./financial-story";

/**
 * Financials V2 view-model (spec §23–30): everything the Financials UI shows,
 * computed deterministically on the server. Sector-aware metric hierarchy,
 * "What changed this quarter", "What matters" — all rules, no prose model.
 * bps vs % distinction is explicit (spec §25).
 */

export interface KeyMetric {
  key: string;
  label: string;
  tooltip: string;
  value: number | null;
  display: string;
  yoyPct: number | null;
  interpretation: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
  spark: Array<number | null>; // oldest→newest, for tiny trend visuals
}

export interface ChangeRow {
  label: string;
  qoq: string | null;
  yoy: string | null;
  tone: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
}

export interface StatementTableRow {
  date: string;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  ebitda: number | null;
  operatingCashFlow: number | null;
  capex: number | null;
  freeCashFlow: number | null;
  cash: number | null;
  totalDebt: number | null;
  equity: number | null;
}

export interface ChartSeries {
  key: string;
  label: string;
  unit: "USD" | "PCT";
  quarterly: Array<{ date: string; value: number | null }>;
  annual: Array<{ date: string; value: number | null }>;
}

export interface FinancialsView {
  symbol: string;
  companyType: CompanySnapshot["identity"]["companyType"];
  story: FinancialStory;
  freshness: {
    latestStatementPeriod: string | null;
    latestReportedPeriod: string | null;
    dataDelayed: boolean;
    fetchedAt: string;
    source: string;
    confidence: string;
  };
  /** The headline result for a reported-but-not-yet-normalized quarter. */
  delayedHeadline: { periodEnd: string; epsActual: number | null; epsEstimate: number | null } | null;
  keyMetrics: KeyMetric[];
  whatChanged: ChangeRow[];
  whatMatters: string[];
  chart: ChartSeries[];
  quarterly: StatementTableRow[];
  annual: StatementTableRow[];
}

const fmtMoney = (v: number | null): string => {
  if (v === null) return "N/A";
  const abs = Math.abs(v);
  const s = abs >= 1e12 ? (v / 1e12).toFixed(2) + "T" : abs >= 1e9 ? (v / 1e9).toFixed(1) + "B" : abs >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v.toFixed(0);
  return "$" + s;
};
const fmtPct = (v: number | null, digits = 1): string => (v === null ? "N/A" : `${(v * 100).toFixed(digits)}%`);

function pctChange(now: number | null, before: number | null): number | null {
  if (now === null || before === null || before === 0) return null;
  if (before < 0) return null;
  return ((now - before) / before) * 100;
}

/** Percentage-POINT change for ratio metrics, in basis points. */
function bpsChange(now: number | null, before: number | null): number | null {
  if (now === null || before === null) return null;
  return (now - before) * 10_000;
}

function seriesOf(rows: CompanySnapshot["quarterly"], pick: (r: CompanySnapshot["quarterly"][number]) => number | null, n = 8): Array<number | null> {
  return rows.slice(0, n).map(pick).reverse(); // oldest→newest
}

export function buildFinancialsView(s: CompanySnapshot): FinancialsView {
  const t = s.identity.companyType;
  const story = buildFinancialStory(s);
  const q = s.quarterly;
  const rev = q.map((r) => r.revenue);
  const ni = q.map((r) => r.netIncome);
  const fcf = q.map((r) => r.freeCashFlow);

  const revTtm = s.revenueTtm;
  const revTtmPrev = q.length >= 8 ? sumComplete(rev.slice(4), 4) : null;
  const niTtm = s.netIncomeTtm;
  const niTtmPrev = q.length >= 8 ? sumComplete(ni.slice(4), 4) : null;
  const fcfTtm = s.freeCashFlowTtm;
  const fcfTtmPrev = q.length >= 8 ? sumComplete(fcf.slice(4), 4) : null;

  // ------------------------------------------------- sector-aware key metrics
  const M = (
    key: string, label: string, tooltip: string,
    value: number | null, display: string, yoyPct: number | null,
    interp: KeyMetric["interpretation"],
    spark: Array<number | null> = [],
  ): KeyMetric => ({ key, label, tooltip, value, display, yoyPct, interpretation: interp, spark });

  const posIfUp = (g: number | null): KeyMetric["interpretation"] =>
    g === null ? null : g > 2 ? "POSITIVE" : g < -2 ? "NEGATIVE" : "NEUTRAL";

  const common: KeyMetric[] = [
    M("revenue", "Revenue (TTM)", "Total sales over the trailing 12 months.",
      revTtm, fmtMoney(revTtm), pctChange(revTtm, revTtmPrev), posIfUp(pctChange(revTtm, revTtmPrev)), seriesOf(q, (r) => r.revenue)),
    M("netIncome", "Net Income (TTM)", "Profit after all costs and taxes.",
      niTtm, fmtMoney(niTtm), pctChange(niTtm, niTtmPrev), posIfUp(pctChange(niTtm, niTtmPrev)), seriesOf(q, (r) => r.netIncome)),
    M("fcf", "Free Cash Flow (TTM)", "Cash generated after operating expenses and capital investment.",
      fcfTtm, fmtMoney(fcfTtm), pctChange(fcfTtm, fcfTtmPrev), posIfUp(pctChange(fcfTtm, fcfTtmPrev)), seriesOf(q, (r) => r.freeCashFlow)),
    M("cash", "Cash", "Cash and short-term investments on the latest balance sheet.",
      s.cash, fmtMoney(s.cash), null, null, seriesOf(q, (r) => r.cash)),
    M("netDebt", "Net Debt", "Total debt minus cash. Negative means net cash.",
      s.netDebt, s.netDebt === null ? "N/A" : s.netDebt < 0 ? `Net cash ${fmtMoney(Math.abs(s.netDebt))}` : fmtMoney(s.netDebt),
      null, s.netDebt === null ? null : s.netDebt < 0 ? "POSITIVE" : s.netDebtToEbitda !== null && s.netDebtToEbitda > 3 ? "NEGATIVE" : "NEUTRAL",
      seriesOf(q, (r) => (r.totalDebt !== null && r.cash !== null ? r.totalDebt - r.cash : null))),
  ];

  const opMargin = M("opMargin", "Operating Margin (TTM)", "Operating income as a share of revenue.",
    s.operatingMarginTtm, fmtPct(s.operatingMarginTtm), null, null,
    seriesOf(q, (r) => (r.revenue && r.revenue > 0 && r.operatingIncome !== null ? r.operatingIncome / r.revenue : null)));
  const grossMargin = M("grossMargin", "Gross Margin (TTM)", "Revenue left after direct production costs.",
    s.grossMarginTtm, fmtPct(s.grossMarginTtm), null, null,
    seriesOf(q, (r) => (r.revenue && r.revenue > 0 && r.grossProfit !== null ? r.grossProfit / r.revenue : null)));
  const roeM = M("roe", "ROE", "How efficiently shareholder equity generates profit.",
    s.roe, fmtPct(s.roe), null, s.roe !== null ? (s.roe > 0.12 ? "POSITIVE" : s.roe < 0.05 ? "NEGATIVE" : "NEUTRAL") : null);
  const pbM = M("pb", "P/B", "Price relative to book value. Core valuation lens for banks.",
    s.priceToBook, s.priceToBook?.toFixed(2) ?? "N/A", null, null);
  const capexM = M("capex", "Capex (TTM)", "Capital spending on plants, equipment and infrastructure.",
    s.capexTtm, fmtMoney(s.capexTtm), null, null, seriesOf(q, (r) => r.capex));
  const equityM = M("equity", "Equity", "Book value of shareholders' stake.",
    s.equity, fmtMoney(s.equity), null, null, seriesOf(q, (r) => r.equity));

  let keyMetrics: KeyMetric[];
  switch (t) {
    case "BANK":
    case "INSURANCE":
      keyMetrics = [common[0]!, common[1]!, roeM, equityM, pbM, common[3]!];
      break;
    case "REIT":
      keyMetrics = [common[0]!, M("ocf", "Operating Cash Flow (TTM)", "Cash from operations — the FFO-adjacent cash engine of a REIT.",
        s.operatingCashFlowTtm, fmtMoney(s.operatingCashFlowTtm), pctChange(s.operatingCashFlowTtm, q.length >= 8 ? sumComplete(q.map((r) => r.operatingCashFlow).slice(4), 4) : null), null,
        seriesOf(q, (r) => r.operatingCashFlow)), common[4]!, capexM, common[3]!, common[1]!];
      break;
    case "ENERGY":
      keyMetrics = [common[0]!, common[2]!, capexM, common[4]!, common[1]!, opMargin];
      break;
    case "SEMICONDUCTOR":
      keyMetrics = [common[0]!, grossMargin, common[2]!, capexM, common[1]!, common[4]!];
      break;
    default:
      keyMetrics = [common[0]!, common[1]!, common[2]!, opMargin, common[3]!, common[4]!];
  }

  // ------------------------------------------------- what changed this quarter
  const c0 = q[0]; const c1 = q[1]; const c4 = q[4];
  const whatChanged: ChangeRow[] = [];
  if (c0 && c1 && c4) {
    const row = (
      label: string,
      pick: (r: CompanySnapshot["quarterly"][number]) => number | null,
      kind: "money" | "ratio",
      denom?: (r: CompanySnapshot["quarterly"][number]) => number | null,
    ) => {
      const val = (r: CompanySnapshot["quarterly"][number]) => {
        const v = pick(r);
        if (kind === "ratio") {
          const d = denom!(r);
          return v !== null && d !== null && d > 0 ? v / d : null;
        }
        return v;
      };
      const now = val(c0); const prev = val(c1); const yearAgo = val(c4);
      if (now === null) return;
      let qoq: string | null; let yoy: string | null; let toneVal: number | null;
      if (kind === "ratio") {
        const bq = bpsChange(now, prev); const by = bpsChange(now, yearAgo);
        qoq = bq === null ? null : `${bq > 0 ? "+" : ""}${Math.round(bq)} bps QoQ`;
        yoy = by === null ? null : `${by > 0 ? "+" : ""}${Math.round(by)} bps YoY`;
        toneVal = by ?? bq;
        if (toneVal !== null) toneVal = toneVal / 100; // bps → ~pct scale for tone
      } else {
        const pq = pctChange(now, prev); const py = pctChange(now, yearAgo);
        qoq = pq === null ? null : `${pq > 0 ? "+" : ""}${pq.toFixed(1)}% QoQ`;
        yoy = py === null ? null : `${py > 0 ? "+" : ""}${py.toFixed(1)}% YoY`;
        toneVal = py ?? pq;
      }
      if (qoq === null && yoy === null) return;
      whatChanged.push({
        label,
        qoq,
        yoy,
        tone: toneVal === null ? "NEUTRAL" : toneVal > 2 ? "POSITIVE" : toneVal < -2 ? "NEGATIVE" : "NEUTRAL",
      });
    };
    row("Revenue", (r) => r.revenue, "money");
    row("Net income", (r) => r.netIncome, "money");
    row("Gross margin", (r) => r.grossProfit, "ratio", (r) => r.revenue);
    row("Operating margin", (r) => r.operatingIncome, "ratio", (r) => r.revenue);
    row("Free cash flow", (r) => r.freeCashFlow, "money");
    row("Net debt", (r) => (r.totalDebt !== null && r.cash !== null ? r.totalDebt - r.cash : null), "money");
  }

  // ---------------------------------------------------------- what matters
  const whatMatters: string[] = [];
  const gNow = yoyGrowth(revTtm, revTtmPrev);
  const gPrev = q.length >= 12 ? yoyGrowth(revTtmPrev, sumComplete(rev.slice(8), 4)) : null;
  if (gNow !== null && gPrev !== null && gNow > gPrev + 0.02)
    whatMatters.push("Revenue growth accelerated versus the prior year.");
  if (gNow !== null && gPrev !== null && gNow < gPrev - 0.02)
    whatMatters.push("Revenue growth is decelerating versus the prior year.");
  const gmSeries = q.slice(0, 12).map((r) => (r.revenue && r.revenue > 0 && r.grossProfit !== null ? r.grossProfit / r.revenue : null));
  const gmNow = gmSeries[0];
  if (gmNow !== null && gmNow !== undefined && gmSeries.slice(1).every((m) => m === null || m <= gmNow))
    whatMatters.push("Gross margin is at a multi-year high.");
  if (fcfTtm !== null && niTtm !== null && niTtm > 0 && fcfTtm < niTtm * 0.6)
    whatMatters.push("FCF is lagging reported earnings — watch cash conversion.");
  if (s.netDebtToEbitda !== null && s.netDebtToEbitda > 3)
    whatMatters.push(`Leverage is elevated at ${s.netDebtToEbitda.toFixed(1)}× net debt/EBITDA.`);
  if (s.netDebt !== null && s.netDebt < 0)
    whatMatters.push("Balance sheet holds net cash.");
  if (s.meta.dataDelayed)
    whatMatters.push("A newer quarter has been reported but full statements are not yet normalized (DATA DELAYED).");

  // ------------------------------------------------------------------- chart
  const qc = [...q].reverse(); // oldest→newest
  const ac = [...s.annual].reverse();
  const cSeries = (key: string, label: string, unit: "USD" | "PCT", pick: (r: StatementTableRow | CompanySnapshot["quarterly"][number]) => number | null): ChartSeries => ({
    key, label, unit,
    quarterly: qc.slice(-8).map((r) => ({ date: r.date, value: pick(r) })),
    annual: ac.slice(-5).map((r) => ({ date: r.date, value: pick(r) })),
  });
  const chart: ChartSeries[] = [
    cSeries("revenue", "Revenue", "USD", (r) => r.revenue),
    cSeries("netIncome", "Net Income", "USD", (r) => r.netIncome),
    cSeries("fcf", "FCF", "USD", (r) => r.freeCashFlow),
    cSeries("grossMargin", "Gross Margin", "PCT", (r) => (r.revenue && r.revenue > 0 && r.grossProfit !== null ? r.grossProfit / r.revenue : null)),
    cSeries("opMargin", "Operating Margin", "PCT", (r) => (r.revenue && r.revenue > 0 && r.operatingIncome !== null ? r.operatingIncome / r.revenue : null)),
  ];

  const toRow = (r: CompanySnapshot["quarterly"][number]): StatementTableRow => ({
    date: r.date, revenue: r.revenue, grossProfit: r.grossProfit, operatingIncome: r.operatingIncome,
    netIncome: r.netIncome, ebitda: r.ebitda, operatingCashFlow: r.operatingCashFlow,
    capex: r.capex, freeCashFlow: r.freeCashFlow, cash: r.cash, totalDebt: r.totalDebt, equity: r.equity,
  });

  return {
    symbol: s.identity.symbol,
    companyType: t,
    story,
    freshness: {
      latestStatementPeriod: s.meta.latestStatementPeriod,
      latestReportedPeriod: s.meta.latestReportedPeriod,
      dataDelayed: s.meta.dataDelayed,
      fetchedAt: s.meta.fetchedAt,
      source: s.meta.source,
      confidence: s.meta.confidence,
    },
    delayedHeadline: s.meta.dataDelayed && s.earningsHistory[0]
      ? {
          periodEnd: s.earningsHistory[0].periodEnd,
          epsActual: s.earningsHistory[0].epsActual,
          epsEstimate: s.earningsHistory[0].epsEstimate,
        }
      : null,
    keyMetrics,
    whatChanged,
    whatMatters: whatMatters.slice(0, 6),
    chart,
    quarterly: q.slice(0, 12).map(toRow),
    annual: s.annual.slice(0, 6).map(toRow),
  };
}
