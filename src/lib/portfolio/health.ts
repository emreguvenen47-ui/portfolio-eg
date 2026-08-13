import type { Quote, PositionValuation, Thesis } from "@/lib/types";
import type { RiskReport } from "./analytics";
import type { AppSettings } from "./settings";

/**
 * Portfolio health — five deterministic signals and a combined score.
 *
 * Every input here already exists in the analytics bundle, so this costs a few
 * microseconds per render and never calls a model. Health is exactly the kind
 * of thing that must be cheap: it is on the dashboard, it refreshes with the
 * feed, and a metered call per refresh would be the single largest recurring
 * spend in the app.
 */

export type SignalState = "GOOD" | "NORMAL" | "WARNING" | "ELEVATED";

export interface HealthSignal {
  key: string;
  label: string;
  state: SignalState;
  /** The measured value behind the state, formatted for display. */
  value: string;
  /** 0..100 contribution to the combined score. */
  score: number;
  detail: string;
}

export interface HealthReport {
  score: number;
  signals: HealthSignal[];
}

/** Linear map with clamping — worse than `bad` scores 0, better than `good` scores 100. */
function grade(value: number, good: number, bad: number): number {
  if (bad === good) return 100;
  const t = (value - bad) / (good - bad);
  return Math.round(Math.max(0, Math.min(1, t)) * 100);
}

const stateFor = (score: number): SignalState =>
  score >= 75 ? "GOOD" : score >= 50 ? "NORMAL" : score >= 30 ? "WARNING" : "ELEVATED";

export function assessHealth(
  rows: PositionValuation[],
  risk: RiskReport,
  quotes: Record<string, Quote>,
  theses: Thesis[],
  settings: AppSettings,
): HealthReport {
  const signals: HealthSignal[] = [];

  // 1. Allocation drift — worst absolute gap between current and target weight.
  const maxDrift = rows.reduce((m, r) => Math.max(m, Math.abs(r.drift)), 0);
  const driftScore = grade(maxDrift, 0, Math.max(settings.driftThreshold * 2, 0.06));
  signals.push({
    key: "drift",
    label: "Allocation Drift",
    state: stateFor(driftScore),
    value: `${(maxDrift * 100).toFixed(1)}pp worst`,
    score: driftScore,
    detail: `Threshold is ${(settings.driftThreshold * 100).toFixed(1)}pp. Measured against the workbook's target weights.`,
  });

  // 2. Concentration — Herfindahl index, reported as its effective-N inverse.
  const hhi = rows.reduce((s, r) => s + r.currentWeight ** 2, 0);
  const effectiveN = hhi > 0 ? 1 / hhi : 0;
  const concScore = grade(effectiveN, 10, 3);
  signals.push({
    key: "concentration",
    label: "Concentration",
    state: stateFor(concScore),
    value: `${effectiveN.toFixed(1)} effective positions`,
    score: concScore,
    detail:
      "Inverse Herfindahl across current weights. Ten equally-sized sleeves score full marks; three score zero.",
  });

  // 3. Volatility — covariance-based annual vol against the workbook assumption.
  const volScore = grade(risk.annualVolatility, 0.08, 0.25);
  signals.push({
    key: "volatility",
    label: "Volatility",
    state: stateFor(volScore),
    value: `${(risk.annualVolatility * 100).toFixed(1)}% annual`,
    score: volScore,
    detail: `Covariance-based, ${risk.observations} observations, ${risk.method} method.`,
  });

  // 4. Thesis health — share of positions whose thesis is still green.
  const rated = theses.filter((t) => t.status);
  const green = rated.filter((t) => t.status === "GREEN").length;
  const red = rated.filter((t) => t.status === "RED").length;
  const thesisScore = rated.length
    ? Math.round(((green - red) / rated.length + 1) * 50)
    : 60;
  signals.push({
    key: "thesis",
    label: "Thesis Health",
    state: stateFor(thesisScore),
    value: rated.length ? `${green}/${rated.length} green` : "not reviewed",
    score: thesisScore,
    detail: "Green theses less red theses, over the number reviewed. Reds subtract; yellows are neutral.",
  });

  // 5. Market stress — VIX level, the one external gauge on this panel.
  const vix = quotes.VIX?.price ?? null;
  const stressScore = vix === null ? 60 : grade(vix, 14, 30);
  signals.push({
    key: "stress",
    label: "Market Stress",
    state: stateFor(stressScore),
    value: vix === null ? "VIX unavailable" : `VIX ${vix.toFixed(1)}`,
    score: stressScore,
    detail: "VIX at 14 or below scores full marks; 30 or above scores zero.",
  });

  const score = Math.round(signals.reduce((s, x) => s + x.score, 0) / signals.length);
  return { score, signals };
}
