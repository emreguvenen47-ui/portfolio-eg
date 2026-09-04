import type { Candle } from "@/lib/types";

/**
 * Technical Engine V2 — deterministic market structure (master spec §22–23).
 *
 * NO AI anywhere in here. Same candles + same settings → same levels, always.
 * Pipeline: swing pivots → candidate levels → ATR-tolerance clustering →
 * confluence scoring (touches, volume, recency, round numbers, MA/VWAP/gap
 * agreement) → hierarchy (primary/secondary/major) → trend structure →
 * state machine → invalidation / breakout triggers.
 */

export interface TechnicalLevel {
  price: number;
  kind: "SUPPORT" | "RESISTANCE";
  rank: "PRIMARY" | "SECONDARY" | "MAJOR";
  score: number; // 0..100 confluence
  touches: number;
  lastTouch: string; // ISO date of most recent pivot in the cluster
  sources: string[]; // e.g. ["pivot×4","MA200","gap","round"]
}

export type TrendStructure =
  | "UPTREND"
  | "DOWNTREND"
  | "RANGE"
  | "RECOVERY"
  | "BREAKDOWN"
  | "INSUFFICIENT_DATA";

export type TechnicalState =
  | "STRONG_BUY_SETUP"
  | "BUY_SETUP"
  | "WATCHING_FOR_ENTRY"
  | "BREAKOUT_PENDING"
  | "RETEST_REQUIRED"
  | "WAIT"
  | "REDUCE"
  | "SELL_SETUP"
  | "INSUFFICIENT_DATA";

export interface TechnicalMap {
  symbol: string;
  price: number;
  atr14: number | null;
  ma50: number | null;
  ma200: number | null;
  anchoredVwap: number | null; // anchored at the most significant low in window
  volumePoc: number | null; // highest-volume price bucket
  nearestGap: { from: number; to: number; direction: "UP" | "DOWN" } | null;
  trend: TrendStructure;
  state: TechnicalState;
  primarySupport: number | null;
  secondarySupport: number | null;
  majorSupport: number | null;
  primaryResistance: number | null;
  secondaryResistance: number | null;
  majorResistance: number | null;
  invalidation: number | null; // close below this voids the bullish structure
  breakoutTrigger: number | null; // close above this confirms breakout
  supports: TechnicalLevel[];
  resistances: TechnicalLevel[];
  asOf: string; // date of last candle used
}

// ------------------------------------------------------------------ helpers

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i]!;
  return s / period;
}

export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  return sma(trs, period);
}

interface Pivot {
  index: number;
  date: string;
  price: number;
  kind: "HIGH" | "LOW";
  volume: number;
}

/** Fractal pivots: a bar whose high/low is the extreme of ±k neighbours. */
export function findPivots(candles: Candle[], k = 3): Pivot[] {
  const out: Pivot[] = [];
  for (let i = k; i < candles.length - k; i++) {
    const c = candles[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (candles[j]!.high >= c.high) isHigh = false;
      if (candles[j]!.low <= c.low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) out.push({ index: i, date: c.date, price: c.high, kind: "HIGH", volume: c.volume ?? 0 });
    if (isLow) out.push({ index: i, date: c.date, price: c.low, kind: "LOW", volume: c.volume ?? 0 });
  }
  return out;
}

/** Round-number magnetism: 10/25/50/100 steps depending on price scale. */
function isRoundish(price: number): boolean {
  const step = price >= 500 ? 50 : price >= 100 ? 25 : price >= 20 ? 5 : 1;
  const r = price % step;
  return r < step * 0.02 || r > step * 0.98;
}

interface Cluster {
  prices: number[];
  volumes: number[];
  dates: string[];
  indices: number[];
}

function clusterPivots(pivots: Pivot[], tolerance: number): Cluster[] {
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const clusters: Cluster[] = [];
  for (const p of sorted) {
    const last = clusters[clusters.length - 1];
    const anchor = last ? last.prices.reduce((a, b) => a + b, 0) / last.prices.length : null;
    if (last && anchor !== null && Math.abs(p.price - anchor) <= tolerance) {
      last.prices.push(p.price);
      last.volumes.push(p.volume);
      last.dates.push(p.date);
      last.indices.push(p.index);
    } else {
      clusters.push({ prices: [p.price], volumes: [p.volume], dates: [p.date], indices: [p.index] });
    }
  }
  return clusters;
}

/** Volume point-of-control over the window using ATR-sized price buckets. */
function volumePoc(candles: Candle[], bucket: number): number | null {
  if (candles.length === 0 || !(bucket > 0)) return null;
  const vol = new Map<number, number>();
  for (const c of candles) {
    const key = Math.round(((c.high + c.low) / 2) / bucket);
    vol.set(key, (vol.get(key) ?? 0) + (c.volume ?? 0));
  }
  let best: [number, number] | null = null;
  for (const [k, v] of vol) if (!best || v > best[1]) best = [k, v];
  return best ? best[0] * bucket : null;
}

/** Most recent unfilled gap relative to current price. */
function nearestGap(candles: Candle[]): TechnicalMap["nearestGap"] {
  const price = candles[candles.length - 1]!.close;
  for (let i = candles.length - 1; i > Math.max(0, candles.length - 250); i--) {
    const prev = candles[i - 1]!;
    const cur = candles[i]!;
    if (cur.low > prev.high) {
      // Up-gap: support zone below if still above it, else overhead.
      const lo = prev.high;
      const hi = cur.low;
      const filled = candles.slice(i).some((c) => c.low <= lo);
      if (!filled) return { from: lo, to: hi, direction: price >= hi ? "DOWN" : "UP" };
    }
    if (cur.high < prev.low) {
      const lo = cur.high;
      const hi = prev.low;
      const filled = candles.slice(i).some((c) => c.high >= hi);
      if (!filled) return { from: lo, to: hi, direction: price >= hi ? "DOWN" : "UP" };
    }
  }
  return null;
}

function trendStructure(pivots: Pivot[], price: number, ma50: number | null, ma200: number | null): TrendStructure {
  const highs = pivots.filter((p) => p.kind === "HIGH").slice(-3);
  const lows = pivots.filter((p) => p.kind === "LOW").slice(-3);
  if (highs.length < 2 || lows.length < 2) return "INSUFFICIENT_DATA";
  const hh = highs[highs.length - 1]!.price > highs[highs.length - 2]!.price;
  const hl = lows[lows.length - 1]!.price > lows[lows.length - 2]!.price;
  const lh = highs[highs.length - 1]!.price < highs[highs.length - 2]!.price;
  const ll = lows[lows.length - 1]!.price < lows[lows.length - 2]!.price;
  const aboveMas = ma50 !== null && ma200 !== null && price > ma50 && price > ma200;
  const belowMas = ma50 !== null && ma200 !== null && price < ma50 && price < ma200;
  if (hh && hl) return aboveMas || !belowMas ? "UPTREND" : "RECOVERY";
  if (lh && ll) return belowMas || !aboveMas ? "DOWNTREND" : "BREAKDOWN";
  if (hl && lh) return "RANGE";
  if (hh && ll) return "RANGE";
  return price >= (ma200 ?? price) ? "RECOVERY" : "BREAKDOWN";
}

// --------------------------------------------------------------------- main

export function buildTechnicalMap(symbol: string, candles: Candle[]): TechnicalMap {
  const usable = candles.filter((c) => Number.isFinite(c.close) && c.close > 0);
  const last = usable[usable.length - 1];
  if (!last || usable.length < 60) {
    return {
      symbol,
      price: last?.close ?? 0,
      atr14: null, ma50: null, ma200: null, anchoredVwap: null, volumePoc: null,
      nearestGap: null,
      trend: "INSUFFICIENT_DATA",
      state: "INSUFFICIENT_DATA",
      primarySupport: null, secondarySupport: null, majorSupport: null,
      primaryResistance: null, secondaryResistance: null, majorResistance: null,
      invalidation: null, breakoutTrigger: null,
      supports: [], resistances: [],
      asOf: last?.date ?? "",
    };
  }

  const price = last.close;
  const closes = usable.map((c) => c.close);
  const window = usable.slice(-500);
  const a = atr(window, 14);
  const ma50v = sma(closes, 50);
  const ma200v = sma(closes, 200);

  const pivots = findPivots(window, 3);

  // Anchored VWAP from the lowest low of the window (the structural anchor a
  // human would pick: "the bottom of this move").
  let anchorIdx = 0;
  for (let i = 0; i < window.length; i++) if (window[i]!.low < window[anchorIdx]!.low) anchorIdx = i;
  let pv = 0;
  let vv = 0;
  for (let i = anchorIdx; i < window.length; i++) {
    const c = window[i]!;
    const typical = (c.high + c.low + c.close) / 3;
    const vol = c.volume ?? 0;
    pv += typical * vol;
    vv += vol;
  }
  const avwap = vv > 0 ? pv / vv : null;

  const tol = (a ?? price * 0.02) * 0.9;
  const clusters = clusterPivots(pivots, tol);
  const lastIndex = window.length - 1;

  const levels: TechnicalLevel[] = clusters
    .map((cl) => {
      const level = cl.prices.reduce((x, y) => x + y, 0) / cl.prices.length;
      const touches = cl.prices.length;
      const recency = Math.max(...cl.indices) / lastIndex; // 0..1
      const volScore = Math.min(1, cl.volumes.reduce((x, y) => x + y, 0) / (window.reduce((s, c) => s + (c.volume ?? 0), 0) / 20 || 1));
      const sources = [`pivot×${touches}`];
      let confluence = 0;
      const near = (x: number | null) => x !== null && Math.abs(x - level) <= tol;
      if (near(ma50v)) { confluence += 8; sources.push("MA50"); }
      if (near(ma200v)) { confluence += 12; sources.push("MA200"); }
      if (near(avwap)) { confluence += 10; sources.push("aVWAP"); }
      if (isRoundish(level)) { confluence += 5; sources.push("round"); }
      const score = Math.max(1, Math.min(100, Math.round(
        touches * 14 + recency * 22 + volScore * 18 + confluence,
      )));
      return {
        price: Number(level.toFixed(2)),
        kind: (level <= price ? "SUPPORT" : "RESISTANCE") as "SUPPORT" | "RESISTANCE",
        rank: "SECONDARY" as const,
        score,
        touches,
        lastTouch: cl.dates.sort().at(-1) ?? last.date,
        sources,
      };
    })
    // Levels glued to price are noise, not structure.
    .filter((l) => Math.abs(l.price - price) > tol * 0.5);

  const supports = levels.filter((l) => l.kind === "SUPPORT").sort((x, y) => y.price - x.price);
  const resistances = levels.filter((l) => l.kind === "RESISTANCE").sort((x, y) => x.price - y.price);

  // Hierarchy: nearest strong level = PRIMARY; strongest overall = MAJOR.
  const assignRanks = (arr: TechnicalLevel[]) => {
    if (arr.length === 0) return;
    const strongEnough = arr.filter((l) => l.score >= 35);
    const pool = strongEnough.length ? strongEnough : arr;
    pool[0]!.rank = "PRIMARY";
    const major = [...arr].sort((x, y) => y.score - x.score)[0]!;
    if (major !== pool[0]) major.rank = "MAJOR";
    const secondary = pool[1];
    if (secondary && secondary.rank === "SECONDARY") secondary.rank = "SECONDARY";
  };
  assignRanks(supports);
  assignRanks(resistances);

  const primarySupport = supports.find((l) => l.rank === "PRIMARY")?.price ?? null;
  const majorSupport =
    supports.find((l) => l.rank === "MAJOR")?.price ??
    supports[supports.length - 1]?.price ?? null;
  const secondarySupport =
    supports.filter((l) => l.price !== primarySupport && l.price !== majorSupport)[0]?.price ?? null;
  const primaryResistance = resistances.find((l) => l.rank === "PRIMARY")?.price ?? null;
  const majorResistance =
    resistances.find((l) => l.rank === "MAJOR")?.price ??
    resistances[resistances.length - 1]?.price ?? null;
  const secondaryResistance =
    resistances.filter((l) => l.price !== primaryResistance && l.price !== majorResistance)[0]?.price ?? null;

  const trend = trendStructure(pivots, price, ma50v, ma200v);
  const invalidation =
    primarySupport !== null && a !== null ? Number((primarySupport - 0.6 * a).toFixed(2)) : null;
  const breakoutTrigger =
    primaryResistance !== null && a !== null ? Number((primaryResistance + 0.25 * a).toFixed(2)) : null;

  // ----------------------------------------------------------- state machine
  let state: TechnicalState = "WAIT";
  const distToSupport = primarySupport !== null && a ? (price - primarySupport) / a : null;
  const distToResistance = primaryResistance !== null && a ? (primaryResistance - price) / a : null;
  const supportScore = supports.find((l) => l.rank === "PRIMARY")?.score ?? 0;

  if (trend === "UPTREND" || trend === "RECOVERY") {
    if (distToSupport !== null && distToSupport <= 1.2 && supportScore >= 45) {
      state = trend === "UPTREND" ? "STRONG_BUY_SETUP" : "BUY_SETUP";
    } else if (distToResistance !== null && distToResistance <= 0.8) {
      state = "BREAKOUT_PENDING";
    } else if (distToSupport !== null && distToSupport <= 2.5) {
      state = "WATCHING_FOR_ENTRY";
    } else {
      state = "WAIT";
    }
  } else if (trend === "RANGE") {
    state =
      distToSupport !== null && distToSupport <= 1 ? "BUY_SETUP"
      : distToResistance !== null && distToResistance <= 1 ? "REDUCE"
      : "WAIT";
  } else if (trend === "DOWNTREND") {
    state = distToResistance !== null && distToResistance <= 1 ? "SELL_SETUP" : "WAIT";
  } else if (trend === "BREAKDOWN") {
    state = "RETEST_REQUIRED";
  }

  return {
    symbol,
    price,
    atr14: a,
    ma50: ma50v,
    ma200: ma200v,
    anchoredVwap: avwap !== null ? Number(avwap.toFixed(2)) : null,
    volumePoc: volumePoc(window, (a ?? price * 0.02) || 1),
    nearestGap: nearestGap(window),
    trend,
    state,
    primarySupport,
    secondarySupport,
    majorSupport,
    primaryResistance,
    secondaryResistance,
    majorResistance,
    invalidation,
    breakoutTrigger,
    supports,
    resistances,
    asOf: last.date,
  };
}
