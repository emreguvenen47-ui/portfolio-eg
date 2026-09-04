import type { TechnicalMap } from "./technical";

/**
 * Trade Engine (master spec §26): Technical Map → actionable trade card.
 * Fundamental BUY never overrides technical WAIT; the two are surfaced
 * side-by-side and this card only speaks for structure.
 */

export interface TradeCard {
  state: TechnicalMap["state"];
  price: number;
  entry: number | null;
  stop: number | null;
  target1: number | null;
  target2: number | null;
  riskPct: number | null;
  rewardPct: number | null;
  riskReward: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  note: string;
}

export function buildTradeCard(map: TechnicalMap): TradeCard {
  const empty: TradeCard = {
    state: map.state,
    price: map.price,
    entry: null,
    stop: null,
    target1: null,
    target2: null,
    riskPct: null,
    rewardPct: null,
    riskReward: null,
    confidence: "LOW",
    note: "Not enough structure to define a trade.",
  };
  if (map.state === "INSUFFICIENT_DATA" || map.price <= 0) return empty;

  const entry =
    map.state === "BREAKOUT_PENDING"
      ? map.breakoutTrigger
      : map.primarySupport !== null
        ? Number((map.primarySupport * 1.002).toFixed(2))
        : null;
  const stop = map.invalidation;
  const target1 = map.primaryResistance;
  const target2 = map.majorResistance !== map.primaryResistance ? map.majorResistance : null;

  if (entry === null || stop === null || target1 === null || entry <= stop) {
    return { ...empty, note: "Structure incomplete (missing support, resistance, or invalidation)." };
  }

  const risk = (entry - stop) / entry;
  const reward = (target1 - entry) / entry;
  const rr = risk > 0 ? reward / risk : null;

  const supportScore = map.supports.find((l) => l.rank === "PRIMARY")?.score ?? 0;
  const confidence: TradeCard["confidence"] =
    rr !== null && rr >= 2 && supportScore >= 55 ? "HIGH" : rr !== null && rr >= 1.2 ? "MEDIUM" : "LOW";

  const note =
    map.state === "BREAKOUT_PENDING"
      ? `Entry on close above ${entry.toFixed(2)}; invalid below ${stop.toFixed(2)}.`
      : `Accumulation zone near ${entry.toFixed(2)}; invalid on close below ${stop.toFixed(2)}.`;

  return {
    state: map.state,
    price: map.price,
    entry,
    stop,
    target1,
    target2,
    riskPct: Number((risk * 100).toFixed(1)),
    rewardPct: Number((reward * 100).toFixed(1)),
    riskReward: rr !== null ? Number(rr.toFixed(2)) : null,
    confidence,
    note,
  };
}
