import type { FinancialPeriod, KeyMetrics } from "@/lib/providers/fundamentals";
import { netCash, roic, ttmGrowth } from "./statements";
import { bankMetrics, companyKind, SUPPRESSION_REASON } from "./company-kind";
import type { AnalystReport } from "./analysts";

/**
 * The ten-second read on a company.
 *
 * Arrows are metric-specific by design. Revenue rising is an improvement;
 * debt rising is not; a P/E rising is neither on its own. A generic
 * "positive number is green" rule would say the opposite of the truth on half
 * these rows, so each carries its own polarity and its own flat band.
 */

export interface KeyMetricItem {
  label: string;
  display: string;
  direction: "up" | "flat" | "down";
  hint?: string;
}

const pctChange = (a: number | null | undefined, b: number | null | undefined): number | null =>
  a === null || a === undefined || b === null || b === undefined || b === 0
    ? null
    : ((a - b) / Math.abs(b)) * 100;

const num = (v: number | string | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const compact = (n: number | null): string => {
  if (n === null) return "N/A";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  return `${sign}$${abs.toFixed(0)}`;
};

/** Rate the change, given which direction counts as better. */
function dir(
  change: number | null,
  polarity: "higher-better" | "lower-better" | "neutral",
  band: number,
): "up" | "flat" | "down" {
  if (change === null || polarity === "neutral" || Math.abs(change) < band) return "flat";
  const good = polarity === "higher-better" ? change > 0 : change < 0;
  return good ? "up" : "down";
}

export function buildKeyMetrics(input: {
  metrics: KeyMetrics | null;
  periods: FinancialPeriod[];
  price: number | null;
  analysts: AnalystReport;
  symbol?: string;
}): KeyMetricItem[] {
  const { metrics: m, periods, price, analysts } = input;
  const kind = companyKind(input.symbol ?? "");
  if (kind === "bank" || kind === "insurer") {
    return bankKeyMetrics({ m, periods, price, analysts, kind });
  }
  const last = periods.at(-1) ?? null;
  const prior = periods.length >= 5 ? periods[periods.length - 5] : null;
  const items: KeyMetricItem[] = [];

  const ttm = (f: (p: FinancialPeriod) => number | null): number | null => {
    const w = periods.slice(-4);
    if (w.length < 4) return null;
    return w.reduce<number | null>((s, p) => {
      const v = f(p);
      return s === null || v === null ? null : s + v;
    }, 0);
  };

  // --- growth
  // Filed statements first: the provider's own growth metric is computed on a
  // revenue definition we cannot inspect and misreports some filers badly.
  const revGrowth = ttmGrowth(periods, (p) => p.revenue) ?? num(m?.revenueGrowthTTMYoy);
  items.push({
    label: "Revenue Growth",
    display: revGrowth === null ? "N/A" : `${revGrowth > 0 ? "+" : ""}${revGrowth.toFixed(1)}%`,
    // Growing is better than shrinking; the arrow reads the level, since a
    // growth rate is already a change.
    direction: dir(revGrowth, "higher-better", 2),
    hint: "Trailing twelve-month revenue against the year before.",
  });

  const epsGrowth = ttmGrowth(periods, (p) => p.eps) ?? num(m?.epsGrowthTTMYoy);
  items.push({
    label: "EPS Growth",
    display: epsGrowth === null ? "N/A" : `${epsGrowth > 0 ? "+" : ""}${epsGrowth.toFixed(1)}%`,
    direction: dir(epsGrowth, "higher-better", 2),
  });

  // --- margins, arrowed on the YoY change in the margin itself
  const gmNow = num(m?.grossMarginTTM) ?? ratioPct(last?.grossProfit, last?.revenue);
  const gmThen = ratioPct(prior?.grossProfit, prior?.revenue);
  items.push({
    label: "Gross Margin",
    display: gmNow === null ? "N/A" : `${gmNow.toFixed(1)}%`,
    direction: dir(gmNow !== null && gmThen !== null ? gmNow - gmThen : null, "higher-better", 0.5),
    hint: "Arrow reflects the year-on-year change in the margin, not its level.",
  });

  const omNow = num(m?.operatingMarginTTM) ?? ratioPct(last?.operatingIncome, last?.revenue);
  const omThen = ratioPct(prior?.operatingIncome, prior?.revenue);
  items.push({
    label: "Operating Margin",
    display: omNow === null ? "N/A" : `${omNow.toFixed(1)}%`,
    direction: dir(omNow !== null && omThen !== null ? omNow - omThen : null, "higher-better", 0.5),
  });

  const fcfM = ratioPct(ttm((p) => p.freeCashFlow), ttm((p) => p.revenue));
  const fcfMThen = ratioPct(prior?.freeCashFlow, prior?.revenue);
  items.push({
    label: "FCF Margin",
    display: fcfM === null ? "N/A" : `${fcfM.toFixed(1)}%`,
    direction: dir(fcfM !== null && fcfMThen !== null ? fcfM - fcfMThen : null, "higher-better", 1),
  });

  // --- returns
  const r = last ? roic(last, periods) : null;
  items.push({
    label: "ROIC",
    display: r === null ? "N/A" : `${r.toFixed(0)}%`,
    direction: "flat",
    hint: "NOPAT ÷ (equity + debt − cash) from four quarters of reported figures. N/A when any input is missing.",
  });

  // --- balance sheet
  const nc = last ? netCash(last) : null;
  const ncThen = prior ? netCash(prior) : null;
  items.push({
    label: "Net Debt",
    display: nc === null ? "N/A" : nc >= 0 ? "NET CASH" : compact(Math.abs(nc)),
    // More net cash (or less net debt) is the improvement.
    direction: dir(nc !== null && ncThen !== null ? nc - ncThen : null, "higher-better", Math.abs((ncThen ?? 0) * 0.05) || 1),
    hint: "Cash and short-term investments less total debt.",
  });

  const fcf = ttm((p) => p.freeCashFlow);
  items.push({
    label: "Free Cash Flow",
    display: compact(fcf),
    direction: dir(pctChange(last?.freeCashFlow, prior?.freeCashFlow), "higher-better", 5),
    hint: "Trailing twelve months.",
  });

  // --- valuation. A cheaper multiple is the improvement, but only against
  // this company's own recent level — there is no cross-sector "good" P/E.
  const fpe = num(m?.forwardPE);
  const pe = num(m?.peTTM);
  items.push({
    label: "Forward P/E",
    display: fpe === null ? (pe === null ? "N/A" : `${pe.toFixed(1)}× TTM`) : `${fpe.toFixed(1)}×`,
    direction: "flat",
    hint: "Shown without an arrow: a multiple moving is not an improvement or a deterioration on its own.",
  });

  const peg = num(m?.pegTTM) ?? num(m?.forwardPEG);
  items.push({
    label: "PEG",
    display: peg === null ? "N/A" : `${peg.toFixed(2)}×`,
    direction: "flat",
    hint: "P/E relative to growth. Below 1× is often read as growth being cheaply priced.",
  });

  // --- price position
  const hi = num(m?.["52WeekHigh"]);
  const lo = num(m?.["52WeekLow"]);
  const pos = price !== null && hi !== null && lo !== null && hi > lo ? ((price - lo) / (hi - lo)) * 100 : null;
  items.push({
    label: "52W Price Position",
    display: pos === null ? "N/A" : `${pos.toFixed(0)}%`,
    direction: "flat",
    hint: "Where the price sits between its 52-week low and high. Neither end is inherently good.",
  });

  // --- analyst upside
  const upside =
    analysts.targets && price ? (analysts.targets.mean / price - 1) * 100 : null;
  items.push({
    label: "Analyst Upside",
    display: upside === null ? "N/A" : `${upside > 0 ? "+" : ""}${upside.toFixed(1)}%`,
    direction: "flat",
    hint:
      upside === null
        ? "Price targets are not available on the configured data plan."
        : "To the mean published target.",
  });

  return items;
}

const ratioPct = (a: number | null | undefined, b: number | null | undefined): number | null =>
  a === null || a === undefined || b === null || b === undefined || b === 0 ? null : (a / b) * 100;

/**
 * The ten-second read on a bank.
 *
 * Return on equity, book value and price to book replace margins, free cash
 * flow and net debt. The suppressed rows are shown once, explicitly marked
 * not-applicable, so their absence reads as a decision rather than a gap.
 */
function bankKeyMetrics(input: {
  m: KeyMetrics | null;
  periods: FinancialPeriod[];
  price: number | null;
  analysts: AnalystReport;
  kind: "bank" | "insurer";
}): KeyMetricItem[] {
  const { m, periods, price, analysts, kind } = input;
  const b = bankMetrics(m, periods);
  const items: KeyMetricItem[] = [];

  items.push({
    label: "Net Income Growth",
    display: b.netIncomeGrowth === null ? "N/A" : `${b.netIncomeGrowth > 0 ? "+" : ""}${b.netIncomeGrowth.toFixed(1)}%`,
    direction: dir(b.netIncomeGrowth, "higher-better", 2),
    hint: "Trailing twelve months against the year before, from filed statements.",
  });
  items.push({
    label: "ROE",
    display: b.roe === null ? "N/A" : `${b.roe.toFixed(1)}%`,
    direction: "flat",
    hint: "The headline profitability measure for a balance-sheet business.",
  });
  items.push({
    label: "ROA",
    display: b.roa === null ? "N/A" : `${b.roa.toFixed(2)}%`,
    direction: "flat",
  });
  items.push({
    label: "Equity / Assets",
    display: b.equityToAssets === null ? "N/A" : `${b.equityToAssets.toFixed(1)}%`,
    direction: "flat",
    hint: "Reported equity over reported assets. NOT a regulatory capital adequacy ratio.",
  });
  items.push({
    label: "P/B",
    display: b.priceToBook === null ? "N/A" : `${b.priceToBook.toFixed(2)}×`,
    direction: "flat",
    hint: "The primary valuation anchor for banks.",
  });
  items.push({
    label: "Book Value / Share",
    display: b.bookValuePerShare === null ? "N/A" : b.bookValuePerShare.toFixed(2),
    direction: "flat",
  });
  const num2 = (v: number | string | undefined) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const pe = num2(m?.peTTM);
  items.push({
    label: "P/E (TTM)",
    display: pe === null ? "N/A" : `${pe.toFixed(1)}×`,
    direction: "flat",
  });
  const dy = num2(m?.dividendYieldIndicatedAnnual);
  items.push({
    label: "Dividend Yield",
    display: dy === null ? "N/A" : `${dy.toFixed(2)}%`,
    direction: "flat",
  });

  const hi = num2(m?.["52WeekHigh"]);
  const lo = num2(m?.["52WeekLow"]);
  const pos = price !== null && hi !== null && lo !== null && hi > lo ? ((price - lo) / (hi - lo)) * 100 : null;
  items.push({
    label: "52W Price Position",
    display: pos === null ? "N/A" : `${pos.toFixed(0)}%`,
    direction: "flat",
  });

  const upside = analysts.targets && price ? (analysts.targets.mean / price - 1) * 100 : null;
  items.push({
    label: "Analyst Upside",
    display: upside === null ? "N/A" : `${upside > 0 ? "+" : ""}${upside.toFixed(1)}%`,
    direction: "flat",
    hint: upside === null ? "Price targets are not available on the configured data plan." : undefined,
  });

  items.push({
    label: "Gross Margin",
    display: "N/A",
    direction: "flat",
    hint: SUPPRESSION_REASON[kind],
  });
  items.push({
    label: "Free Cash Flow",
    display: "N/A",
    direction: "flat",
    hint: SUPPRESSION_REASON[kind],
  });

  return items;
}
