import type { KeyMetrics } from "@/lib/providers/fundamentals";
import type { InsiderReport } from "./insiders";
import type { AnalystReport } from "./analysts";
import type { GuidanceReport } from "./guidance";
import type { HealthReport } from "./health";

/**
 * Smart Money: the signals that exist, on one line each.
 *
 * The score is the mean of the components that had data. A missing component
 * is dropped from the denominator, never scored zero — a stock with no analyst
 * coverage is not thereby a worse company, and averaging in a zero would say
 * exactly that. Coverage is reported alongside the number so a 5-of-9 score is
 * visibly weaker evidence than a 9-of-9 one.
 *
 * Nothing here calls a model.
 */

export type SignalTone = "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "NA";

export interface SmartSignal {
  key: string;
  label: string;
  /** What the panel prints in the value column. */
  display: string;
  tone: SignalTone;
  /** 0..100, or null when the signal has no data. */
  score: number | null;
  /** How this row was derived, for the tooltip. */
  basis: string;
}

export interface SmartMoney {
  signals: SmartSignal[];
  score: number | null;
  coverage: number;
  total: number;
}

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export function buildSmartMoney(input: {
  insiders: InsiderReport | null;
  analysts: AnalystReport;
  guidance: GuidanceReport;
  health: HealthReport;
  metrics: KeyMetrics | null;
  technical: "BULLISH" | "NEUTRAL" | "BEARISH" | null;
  valuation: "CHEAP" | "FAIR" | "EXPENSIVE" | "N/A";
}): SmartMoney {
  const { insiders, analysts, guidance, health, technical, valuation } = input;
  const signals: SmartSignal[] = [];

  // --- insiders
  if (!insiders || insiders.windows[2].buyCount + insiders.windows[2].sellCount === 0) {
    signals.push({
      key: "insiders",
      label: "Insiders",
      display: "N/A",
      tone: "NA",
      score: null,
      basis: "No open-market insider transactions on file in the last year.",
    });
  } else {
    const map: Record<string, { score: number; tone: SignalTone; display: string }> = {
      "STRONG BUYING": { score: 100, tone: "POSITIVE", display: "STRONG POSITIVE" },
      BUYING: { score: 75, tone: "POSITIVE", display: "POSITIVE" },
      NEUTRAL: { score: 50, tone: "NEUTRAL", display: "NEUTRAL" },
      SELLING: { score: 30, tone: "NEGATIVE", display: "NEGATIVE" },
      "STRONG SELLING": { score: 10, tone: "NEGATIVE", display: "STRONG NEGATIVE" },
    };
    const hit = map[insiders.signal];
    signals.push({
      key: "insiders",
      label: "Insiders",
      display: hit.display,
      tone: hit.tone,
      score: hit.score,
      basis: insiders.rationale,
    });
  }

  // --- analyst consensus
  if (analysts.label === "N/A" || !analysts.latest) {
    signals.push({
      key: "consensus",
      label: "Analyst Consensus",
      display: "N/A",
      tone: "NA",
      score: null,
      basis: "No analyst coverage on file.",
    });
  } else {
    // Consensus score runs −100..100; rescale to 0..100.
    const s = clamp((analysts.latest.score + 100) / 2);
    signals.push({
      key: "consensus",
      label: "Analyst Consensus",
      display: analysts.label,
      tone: s >= 60 ? "POSITIVE" : s <= 40 ? "NEGATIVE" : "NEUTRAL",
      score: s,
      basis: `${analysts.latest.strongBuy + analysts.latest.buy} buy, ${analysts.latest.hold} hold, ${analysts.latest.sell + analysts.latest.strongSell} sell (${analysts.latest.period}).`,
    });
  }

  // --- recent analyst actions, from how the consensus book has shifted
  if (analysts.momentum === "N/A") {
    signals.push({
      key: "actions",
      label: "Recent Actions",
      display: "N/A",
      tone: "NA",
      score: null,
      basis: analysts.momentumNote,
    });
  } else {
    const s = analysts.momentum === "IMPROVING" ? 80 : analysts.momentum === "DETERIORATING" ? 20 : 50;
    signals.push({
      key: "actions",
      label: "Recent Actions",
      display: analysts.momentum,
      tone: s >= 60 ? "POSITIVE" : s <= 40 ? "NEGATIVE" : "NEUTRAL",
      score: s,
      basis: analysts.momentumNote,
    });
  }

  // --- target direction: no provider carries targets on this plan
  signals.push({
    key: "targets",
    label: "Target Direction",
    display: "N/A",
    tone: "NA",
    score: null,
    basis: analysts.gapNote,
  });

  // --- estimate revisions: same gap
  signals.push({
    key: "revisions",
    label: "Estimate Revisions",
    display: "N/A",
    tone: "NA",
    score: null,
    basis: "Forward revenue and EPS estimates are not available on the configured data plan.",
  });

  // --- guidance
  if (!guidance.available || guidance.trend === "N/A") {
    signals.push({
      key: "guidance",
      label: "Management Guidance",
      display: "N/A",
      tone: "NA",
      score: null,
      basis: guidance.note,
    });
  } else {
    const s = guidance.trend === "IMPROVING" ? 85 : guidance.trend === "DETERIORATING" ? 15 : 50;
    signals.push({
      key: "guidance",
      label: "Management Guidance",
      display: guidance.trend,
      tone: s >= 60 ? "POSITIVE" : s <= 40 ? "NEGATIVE" : "NEUTRAL",
      score: s,
      basis: guidance.note,
    });
  }

  // --- institutional ownership: not on this plan
  signals.push({
    key: "institutional",
    label: "Institutional",
    display: "N/A",
    tone: "NA",
    score: null,
    basis: "Institutional and fund ownership are not available on the configured data plan.",
  });

  // --- financial quality
  signals.push({
    key: "quality",
    label: "Financial Quality",
    display: health.total === null ? "N/A" : `${health.total}/100`,
    tone: health.total === null ? "NA" : health.total >= 65 ? "POSITIVE" : health.total <= 40 ? "NEGATIVE" : "NEUTRAL",
    score: health.total,
    basis: `House quality heuristic across ${health.coverage} of 5 pillars.`,
  });

  // --- valuation
  const valScore: Record<string, number | null> = { CHEAP: 80, FAIR: 55, EXPENSIVE: 25, "N/A": null };
  signals.push({
    key: "valuation",
    label: "Valuation",
    display: valuation,
    tone:
      valuation === "CHEAP" ? "POSITIVE" : valuation === "EXPENSIVE" ? "NEGATIVE" : valuation === "N/A" ? "NA" : "NEUTRAL",
    score: valScore[valuation] ?? null,
    basis: "Median verdict across the P/E, P/B, P/S and P/FCF rows below.",
  });

  // --- technical
  signals.push({
    key: "technical",
    label: "Technical",
    display: technical ?? "N/A",
    tone: technical === "BULLISH" ? "POSITIVE" : technical === "BEARISH" ? "NEGATIVE" : technical === null ? "NA" : "NEUTRAL",
    score: technical === "BULLISH" ? 75 : technical === "BEARISH" ? 25 : technical === null ? null : 50,
    basis: "Price against its 20, 50 and 200-day moving averages.",
  });

  const scored = signals.filter((s) => s.score !== null);
  return {
    signals,
    score: scored.length ? Math.round(scored.reduce((a, b) => a + b.score!, 0) / scored.length) : null,
    coverage: scored.length,
    total: signals.length,
  };
}
