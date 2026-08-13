import type { Recommendation } from "@/lib/providers/fundamentals";

/**
 * Analyst consensus and momentum.
 *
 * The configured Finnhub tier carries the consensus distribution over time,
 * but not price targets and not the individual upgrade/downgrade feed — both
 * return "You don't have access to this resource". So momentum is derived from
 * how the distribution itself has shifted month over month, which is real
 * reported data, and the per-action feed is a declared gap rather than an
 * invention.
 *
 * `AnalystAction` and `AnalystActionSource` below are the seam: a provider
 * that carries the feed only has to produce that shape.
 */

export interface ConsensusRow {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  total: number;
  /** −100..100. Positive means the book leans buy. */
  score: number;
}

export type ConsensusLabel =
  | "STRONG BUY"
  | "BUY"
  | "HOLD"
  | "SELL"
  | "STRONG SELL"
  | "N/A";

export type Momentum = "IMPROVING" | "STABLE" | "DETERIORATING" | "N/A";

/** An individual rating change. No configured provider supplies these today. */
export interface AnalystAction {
  firm: string;
  analyst: string | null;
  date: string;
  fromRating: string | null;
  toRating: string | null;
  fromTarget: number | null;
  toTarget: number | null;
  kind: "UPGRADE" | "DOWNGRADE" | "REITERATED" | "TARGET RAISED" | "TARGET CUT";
}

/** Implement this to light up the action feed and target panels. */
export interface AnalystActionSource {
  actions(symbol: string): Promise<AnalystAction[]>;
  targets(symbol: string): Promise<{ mean: number; high: number; low: number } | null>;
}

export interface AnalystReport {
  latest: ConsensusRow | null;
  history: ConsensusRow[];
  label: ConsensusLabel;
  momentum: Momentum;
  momentumNote: string;
  /** Change in the consensus score over roughly three months. */
  scoreChange: number | null;
  /** Net analysts moving into buy ratings over the same span. */
  netUpgrades: number | null;
  actions: AnalystAction[];
  targets: { mean: number; high: number; low: number } | null;
  /** Why targets/actions are blank, when they are. */
  gapNote: string;
}

function toRow(r: Recommendation): ConsensusRow {
  const total = r.strongBuy + r.buy + r.hold + r.sell + r.strongSell;
  // Weighted −2..+2, rescaled to −100..100.
  const raw = r.strongBuy * 2 + r.buy - r.sell - r.strongSell * 2;
  return {
    period: r.period,
    strongBuy: r.strongBuy,
    buy: r.buy,
    hold: r.hold,
    sell: r.sell,
    strongSell: r.strongSell,
    total,
    score: total > 0 ? (raw / (total * 2)) * 100 : 0,
  };
}

const labelFor = (score: number, total: number): ConsensusLabel => {
  if (total === 0) return "N/A";
  if (score >= 60) return "STRONG BUY";
  if (score >= 20) return "BUY";
  if (score > -20) return "HOLD";
  if (score > -60) return "SELL";
  return "STRONG SELL";
};

export function analyseAnalysts(
  recs: Recommendation[] | null,
  actions: AnalystAction[] = [],
  targets: { mean: number; high: number; low: number } | null = null,
): AnalystReport {
  const gapNote =
    "Individual analyst actions and price targets are not available on the configured data plan. Consensus counts below are real; nothing here is estimated.";

  if (!recs?.length) {
    return {
      latest: null,
      history: [],
      label: "N/A",
      momentum: "N/A",
      momentumNote: "No analyst coverage on file for this symbol.",
      scoreChange: null,
      netUpgrades: null,
      actions,
      targets,
      gapNote,
    };
  }

  // Finnhub returns newest first; keep chronological for the trend.
  const history = [...recs].map(toRow).sort((a, b) => a.period.localeCompare(b.period));
  const latest = history.at(-1)!;
  const prior = history.length >= 4 ? history[history.length - 4] : (history[0] ?? null);

  const scoreChange = prior && prior !== latest ? latest.score - prior.score : null;
  const netUpgrades = prior
    ? latest.strongBuy + latest.buy - (prior.strongBuy + prior.buy)
    : null;

  let momentum: Momentum = "N/A";
  let momentumNote = "Not enough consensus history to judge direction.";
  if (scoreChange !== null) {
    const months = history.length - 1 - history.indexOf(prior!);
    if (scoreChange > 5) {
      momentum = "IMPROVING";
      momentumNote = `Consensus strengthened ${scoreChange.toFixed(0)} points over ${months} month${months === 1 ? "" : "s"}${netUpgrades && netUpgrades > 0 ? `, a net ${netUpgrades} more buy rating${netUpgrades === 1 ? "" : "s"}` : ""}.`;
    } else if (scoreChange < -5) {
      momentum = "DETERIORATING";
      momentumNote = `Consensus weakened ${Math.abs(scoreChange).toFixed(0)} points over ${months} month${months === 1 ? "" : "s"}${netUpgrades && netUpgrades < 0 ? `, a net ${Math.abs(netUpgrades)} fewer buy ratings` : ""}.`;
    } else {
      momentum = "STABLE";
      momentumNote = `Consensus essentially unchanged over ${months} month${months === 1 ? "" : "s"}.`;
    }
  }

  return {
    latest,
    history: history.slice(-12),
    label: labelFor(latest.score, latest.total),
    momentum,
    momentumNote,
    scoreChange,
    netUpgrades,
    actions,
    targets,
    gapNote,
  };
}

/** Upside to the mean target. Null without a real target — never a guess. */
export const impliedUpside = (
  price: number | null,
  target: number | null,
): number | null =>
  price === null || target === null || price <= 0 ? null : (target / price - 1) * 100;
