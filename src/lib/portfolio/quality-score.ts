import type { KeyMetrics } from "@/lib/providers/fundamentals";

/**
 * Financial quality and valuation labels.
 *
 * A house heuristic, labelled as such wherever it renders. Every sub-score is
 * a clamped linear grade between a stated good and bad level, so the number is
 * reproducible and its methodology fits in a tooltip. Components with no data
 * are dropped from the average rather than scored zero — a missing metric is
 * not a bad one.
 */

export interface QualityBreakdown {
  total: number | null;
  growth: number | null;
  profitability: number | null;
  cashFlow: number | null;
  balanceSheet: number | null;
  efficiency: number | null;
}

const grade = (v: number | undefined, good: number, bad: number): number | null => {
  if (v === undefined || !Number.isFinite(v)) return null;
  return Math.round(Math.max(0, Math.min(1, (v - bad) / (good - bad))) * 100);
};

const mean = (xs: (number | null)[]): number | null => {
  const ok = xs.filter((x): x is number => x !== null);
  return ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : null;
};

export function scoreQuality(m: KeyMetrics | null): QualityBreakdown {
  if (!m) {
    return {
      total: null,
      growth: null,
      profitability: null,
      cashFlow: null,
      balanceSheet: null,
      efficiency: null,
    };
  }

  const growth = mean([
    grade(m.revenueGrowthTTMYoy as number, 25, -5),
    grade(m.epsGrowthTTMYoy as number, 30, -10),
  ]);
  const profitability = mean([
    grade(m.netProfitMarginTTM as number, 25, 0),
    grade(m.operatingMarginTTM as number, 30, 0),
    grade(m.grossMarginTTM as number, 60, 15),
  ]);
  const cashFlow = mean([grade(m.pfcfShareTTM as number, 15, 60)]);
  const balanceSheet = mean([
    grade(m.currentRatioQuarterly as number, 2.5, 0.8),
    // Lower leverage scores better, hence the inverted bounds. Note the slash:
    // that is Finnhub's actual key name, and reading it as an underscore
    // silently dropped leverage from this pillar entirely.
    grade(m["totalDebt/totalEquityQuarterly"] as number, 20, 200),
  ]);
  const efficiency = mean([
    grade(m.roeTTM as number, 25, 0),
    grade(m.roaTTM as number, 12, 0),
  ]);

  return {
    growth,
    profitability,
    cashFlow,
    balanceSheet,
    efficiency,
    total: mean([growth, profitability, cashFlow, balanceSheet, efficiency]),
  };
}

export type ValuationLabel = "CHEAP" | "FAIR" | "EXPENSIVE" | "N/A";

export interface ValuationRow {
  label: string;
  value: number | null;
  verdict: ValuationLabel;
  /** The thresholds used, so the verdict can be checked. */
  rule: string;
}

/** Absolute thresholds, stated in the row so the verdict is auditable. */
function verdict(
  v: number | undefined,
  cheap: number,
  expensive: number,
): { verdict: ValuationLabel; value: number | null } {
  if (v === undefined || !Number.isFinite(v)) return { verdict: "N/A", value: null };
  if (v <= 0) return { verdict: "N/A", value: v };
  return {
    value: v,
    verdict: v < cheap ? "CHEAP" : v > expensive ? "EXPENSIVE" : "FAIR",
  };
}

export function valuationRows(m: KeyMetrics | null): ValuationRow[] {
  if (!m) return [];
  const rows: ValuationRow[] = [];
  const add = (label: string, v: number | undefined, cheap: number, expensive: number) => {
    const r = verdict(v, cheap, expensive);
    rows.push({ label, value: r.value, verdict: r.verdict, rule: `<${cheap} cheap, >${expensive} expensive` });
  };

  add("P/E (TTM)", m.peTTM as number, 15, 30);
  add("P/B", m.pbQuarterly as number, 1.5, 5);
  add("P/S (TTM)", m.psTTM as number, 2, 8);
  add("P/FCF per share", m.pfcfShareTTM as number, 15, 40);

  return rows;
}
