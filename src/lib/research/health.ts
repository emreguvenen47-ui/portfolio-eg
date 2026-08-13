import type { FinancialPeriod, KeyMetrics } from "@/lib/providers/fundamentals";
import { scoreQuality } from "@/lib/portfolio/quality-score";
import { netCash, roic, totalDebt } from "./statements";
import { bankMetrics, companyKind } from "./company-kind";

/**
 * Financial health: the existing quality score, broken into pillars and given
 * evidence.
 *
 * The pillar scores come from the shared `scoreQuality` heuristic so the number
 * on this page matches the one the scanner ranks on. The strengths and watch
 * items are separate: they are drawn from reported statements rather than the
 * score, so each one names a real figure and a real period instead of
 * restating the grade in words.
 */

export interface Pillar {
  key: string;
  label: string;
  score: number | null;
  basis: string;
}

export interface HealthItem {
  text: string;
  /** The reported figures behind the claim. */
  detail: string;
}

export interface HealthReport {
  pillars: Pillar[];
  total: number | null;
  coverage: number;
  strengths: HealthItem[];
  watch: HealthItem[];
}

const pctChange = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100;

const ratio = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : (a / b) * 100;

const usd = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(0)}`;
};

export function buildHealth(
  m: KeyMetrics | null,
  periods: FinancialPeriod[],
  symbol = "",
): HealthReport {
  const kind = companyKind(symbol);
  const q = scoreQuality(m);

  // A bank is graded on the pillars that describe a balance-sheet business.
  // Scoring one on cash-flow and current-ratio pillars produces a confident
  // number computed from metrics that do not apply to it.
  const pillars: Pillar[] =
    kind === "bank" || kind === "insurer"
      ? [
          { key: "growth", label: "Earnings Growth", score: q.growth, basis: "net income and EPS growth YoY" },
          { key: "profitability", label: "Profitability", score: q.profitability, basis: "net margin on revenue net of interest expense" },
          { key: "efficiency", label: "Return on Equity", score: q.efficiency, basis: "return on equity and assets" },
          { key: "capital", label: "Capital", score: capitalScore(m, periods), basis: "equity as a share of total assets" },
        ]
      : [
          { key: "growth", label: "Growth", score: q.growth, basis: "revenue and EPS growth YoY" },
          { key: "profitability", label: "Profitability", score: q.profitability, basis: "gross, operating and net margin" },
          { key: "cashFlow", label: "Cash Flow", score: q.cashFlow, basis: "price to free cash flow per share" },
          { key: "balanceSheet", label: "Balance Sheet", score: q.balanceSheet, basis: "current ratio and debt to equity" },
          { key: "efficiency", label: "Capital Efficiency", score: q.efficiency, basis: "return on equity and assets" },
        ];

  const { strengths, watch } = evidence(periods, m, kind);

  const scored = pillars.filter((p) => p.score !== null);
  return {
    pillars,
    // Recompute from the pillars actually shown, so a bank's score is not the
    // industrial average carried over from `scoreQuality`.
    total: scored.length
      ? Math.round(scored.reduce((a, b) => a + b.score!, 0) / scored.length)
      : null,
    coverage: scored.length,
    strengths: strengths.slice(0, 3),
    watch: watch.slice(0, 3),
  };
}

/**
 * Deterministic strengths and watch items from reported statements.
 *
 * Ordered by how much each says about the business, so the three that survive
 * the slice are the three worth reading first.
 */
/** Equity funding as a share of assets — the only capital read filings give. */
function capitalScore(m: KeyMetrics | null, periods: FinancialPeriod[]): number | null {
  const b = bankMetrics(m, periods);
  if (b.equityToAssets === null) return null;
  // 6% is thin, 15% is strong, for a commercial bank.
  return Math.round(Math.max(0, Math.min(1, (b.equityToAssets - 6) / (15 - 6))) * 100);
}

function evidence(
  periods: FinancialPeriod[],
  m: KeyMetrics | null,
  kind: ReturnType<typeof companyKind> = "operating",
): { strengths: HealthItem[]; watch: HealthItem[] } {
  const bankLike = kind === "bank" || kind === "insurer";
  const strengths: HealthItem[] = [];
  const watch: HealthItem[] = [];
  const last = periods.at(-1) ?? null;
  const prior = periods.length >= 5 ? periods[periods.length - 5] : null;
  if (!last) return { strengths, watch };

  const period = last.quarter === 0 ? `FY${last.year}` : `${last.year} Q${last.quarter}`;

  // --- margins. Gross margin is undefined for a bank, and free cash flow and
  // net-debt commentary describe funding rather than risk, so those blocks are
  // skipped entirely rather than emitting misleading strengths.
  const gmNow = bankLike ? null : ratio(last.grossProfit, last.revenue);
  const gmThen = bankLike || !prior ? null : ratio(prior.grossProfit, prior.revenue);
  if (gmNow !== null && gmThen !== null) {
    const bps = Math.round((gmNow - gmThen) * 100);
    if (bps >= 50) {
      strengths.push({
        text: `Gross margin expanded ${bps}bps YoY`,
        detail: `${gmThen.toFixed(1)}% → ${gmNow.toFixed(1)}% (${period})`,
      });
    } else if (bps <= -50) {
      watch.push({
        text: `Gross margin compressed ${Math.abs(bps)}bps YoY`,
        detail: `${gmThen.toFixed(1)}% → ${gmNow.toFixed(1)}% (${period})`,
      });
    }
  }

  const omNow = ratio(last.operatingIncome, last.revenue);
  const omThen = prior ? ratio(prior.operatingIncome, prior.revenue) : null;
  if (omNow !== null && omThen !== null) {
    const bps = Math.round((omNow - omThen) * 100);
    if (bps >= 100) {
      strengths.push({
        text: `Operating margin expanded ${bps}bps YoY`,
        detail: `${omThen.toFixed(1)}% → ${omNow.toFixed(1)}% (${period})`,
      });
    } else if (bps <= -100) {
      watch.push({
        text: `Operating margin compressed ${Math.abs(bps)}bps YoY`,
        detail: `${omThen.toFixed(1)}% → ${omNow.toFixed(1)}% (${period})`,
      });
    }
  }

  // --- cash flow
  const fcfChange = bankLike || !prior ? null : pctChange(last.freeCashFlow, prior.freeCashFlow);
  if (fcfChange !== null && last.freeCashFlow !== null && prior?.freeCashFlow != null) {
    if (fcfChange >= 15) {
      strengths.push({
        text: `Free cash flow grew ${fcfChange.toFixed(0)}% YoY`,
        detail: `${usd(prior.freeCashFlow)} → ${usd(last.freeCashFlow)} (${period})`,
      });
    } else if (fcfChange <= -15) {
      watch.push({
        text: `Free cash flow declined ${Math.abs(fcfChange).toFixed(0)}% YoY`,
        detail: `${usd(prior.freeCashFlow)} → ${usd(last.freeCashFlow)} (${period})`,
      });
    }
  }

  // --- balance sheet
  const nc = bankLike ? null : netCash(last);
  const debt = bankLike ? null : totalDebt(last);
  if (nc !== null && nc > 0) {
    strengths.push({
      text: "Net cash balance sheet",
      detail: `${usd(nc)} more cash and short-term investments than total debt (${period})`,
    });
  } else if (nc !== null && last.equity && nc < 0 && Math.abs(nc) > last.equity) {
    watch.push({
      text: "Net debt exceeds shareholders' equity",
      detail: `${usd(Math.abs(nc))} net debt vs ${usd(last.equity)} equity (${period})`,
    });
  }

  if (debt !== null && prior) {
    const priorDebt = totalDebt(prior);
    const dc = pctChange(debt, priorDebt);
    if (dc !== null && dc >= 20 && priorDebt !== null) {
      watch.push({
        text: `Total debt rose ${dc.toFixed(0)}% YoY`,
        detail: `${usd(priorDebt)} → ${usd(debt)} (${period})`,
      });
    }
  }

  // --- growth persistence
  const revs = periods.map((p) => p.revenue);
  if (revs.length >= 8) {
    const rates = [0, 1, 2].map((i) =>
      pctChange(revs[revs.length - 1 - i] ?? null, revs[revs.length - 5 - i] ?? null),
    );
    if (rates.every((r) => r !== null)) {
      if (rates[0]! < rates[1]! && rates[1]! < rates[2]!) {
        watch.push({
          text: "Revenue growth slowed for 3 consecutive quarters",
          detail: `${rates[2]!.toFixed(1)}% → ${rates[1]!.toFixed(1)}% → ${rates[0]!.toFixed(1)}% YoY`,
        });
      } else if (rates[0]! > rates[1]! && rates[1]! > rates[2]! && rates[0]! > 0) {
        strengths.push({
          text: "Revenue growth accelerated for 3 consecutive quarters",
          detail: `${rates[2]!.toFixed(1)}% → ${rates[1]!.toFixed(1)}% → ${rates[0]!.toFixed(1)}% YoY`,
        });
      }
    }
  }

  // --- returns on capital
  const r = bankLike ? null : roic(last, periods);
  if (r !== null && r >= 20) {
    strengths.push({
      text: `ROIC of ${r.toFixed(0)}%`,
      detail: `NOPAT over invested capital, from four quarters of reported figures (${period})`,
    });
  } else if (r !== null && r < 5) {
    watch.push({
      text: `ROIC of ${r.toFixed(1)}%`,
      detail: `Returns on invested capital are below most costs of capital (${period})`,
    });
  }

  // --- dilution
  const sharesNow = last.dilutedShares;
  const sharesThen = prior?.dilutedShares ?? null;
  const sc = pctChange(sharesNow, sharesThen);
  if (sc !== null) {
    if (sc <= -2) {
      strengths.push({
        text: `Share count down ${Math.abs(sc).toFixed(1)}% YoY`,
        detail: "Buybacks are outpacing issuance, lifting per-share figures",
      });
    } else if (sc >= 3) {
      watch.push({
        text: `Share count up ${sc.toFixed(1)}% YoY`,
        detail: "Dilution is working against per-share returns",
      });
    }
  }

  // Interest cover is a metric-bag figure, used only if the filings had nothing
  // to say about leverage.
  const cover = m?.netInterestCoverageTTM;
  if (typeof cover === "number" && cover > 0 && cover < 3 && watch.length < 3) {
    watch.push({
      text: `Interest cover of ${cover.toFixed(1)}×`,
      detail: "Operating profit covers interest expense fewer than three times over",
    });
  }

  // --- bank-specific evidence, on measures that do apply
  if (bankLike) {
    const b = bankMetrics(m, periods);
    if (b.roe !== null && b.roe >= 15) {
      strengths.push({ text: `Return on equity of ${b.roe.toFixed(0)}%`, detail: `Comfortably above the cost of equity for most banks (${period})` });
    } else if (b.roe !== null && b.roe < 8) {
      watch.push({ text: `Return on equity of ${b.roe.toFixed(1)}%`, detail: `Below what most banks need to earn their cost of capital (${period})` });
    }
    if (b.equityToAssets !== null && b.equityToAssets >= 12) {
      strengths.push({ text: `Equity funds ${b.equityToAssets.toFixed(1)}% of assets`, detail: `A thick equity layer by reported-statement measures (${period})` });
    } else if (b.equityToAssets !== null && b.equityToAssets < 7) {
      watch.push({ text: `Equity funds only ${b.equityToAssets.toFixed(1)}% of assets`, detail: `Thin by reported-statement measures — not a regulatory capital ratio (${period})` });
    }
    if (b.netIncomeGrowth !== null && b.netIncomeGrowth >= 15) {
      strengths.push({ text: `Net income grew ${b.netIncomeGrowth.toFixed(0)}% YoY`, detail: `Trailing twelve months against the year before (${period})` });
    } else if (b.netIncomeGrowth !== null && b.netIncomeGrowth <= -15) {
      watch.push({ text: `Net income fell ${Math.abs(b.netIncomeGrowth).toFixed(0)}% YoY`, detail: `Trailing twelve months against the year before (${period})` });
    }
  }

  return { strengths, watch };
}
