import type { Candle } from "@/lib/types";
import { atr, buildTechnicalMap, type TechnicalMap } from "./technical";

/**
 * Technical Decision Engine V3 (spec §4–15).
 *
 * Extends — does not replace — the V2 map. Adds: weekly regime from resampled
 * daily bars, momentum/volume/volatility states, structural stop ladder,
 * structural targets, setup classification, expanded signal states, an
 * explainable weighted score, confidence, freshness, and counter-trend
 * handling. Fully deterministic; every number is derivable from the candles.
 *
 * Backtest architecture note: the signal seam (detector consumes only bars
 * ≤ i, measurement runs separately) is adapted from the MIT-licensed
 * maverick-mcp backtesting engine's design (github.com/wshobson/maverick-mcp)
 * — concept adapted to TypeScript, no code copied.
 */

export type SignalState =
  | "STRONG_BUY"
  | "BUY"
  | "BUY_ON_RETEST"
  | "BREAKOUT_BUY"
  | "TACTICAL_BUY"
  | "WATCHING_FOR_ENTRY"
  | "BREAKOUT_PENDING"
  | "RETEST_REQUIRED"
  | "WAIT"
  | "REDUCE"
  | "SELL"
  | "INVALIDATED"
  | "INSUFFICIENT_DATA";

export type SetupType =
  | "SUPPORT_BOUNCE"
  | "BREAKOUT"
  | "BREAKOUT_RETEST"
  | "TREND_CONTINUATION"
  | "PULLBACK_TO_VWAP"
  | "MA50_RETEST"
  | "MAJOR_SUPPORT_REVERSAL"
  | "OVERSOLD_RECOVERY"
  | "SUPPORT_BREAKDOWN"
  | "FAILED_BREAKOUT"
  | "MAJOR_RESISTANCE_REJECTION"
  | "NONE";

export type MomentumState = "STRONG_UP" | "UP" | "FLAT" | "DOWN" | "STRONG_DOWN" | "EXTENDED";
export type VolumeState = "EXPANDING" | "NORMAL" | "CONTRACTING";
export type Freshness = "NEW" | "ACTIVE" | "WEAKENING" | "EXPIRED";

export interface StopLevel {
  kind: "TIGHT" | "STANDARD" | "WIDE";
  price: number;
  riskPct: number;
  atrDistance: number;
  reason: string;
}

export interface ScoreBreakdown {
  trend: number;
  structure: number;
  momentum: number;
  volume: number;
  multiTimeframe: number;
  riskReward: number;
  /** Explicit weights so the composition is auditable (spec §11). */
  weights: Record<string, number>;
  total: number;
}

export interface TechnicalDecision {
  symbol: string;
  asOf: string;
  price: number;

  daily: TechnicalMap;
  weeklyTrend: TechnicalMap["trend"];
  weeklyPrimarySupport: number | null;
  weeklyPrimaryResistance: number | null;

  ma20: number | null;
  momentum: MomentumState;
  volumeState: VolumeState;
  realizedVolAnnualPct: number | null;

  signal: SignalState;
  setup: SetupType;
  counterTrend: boolean;
  score: ScoreBreakdown | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  freshness: Freshness;
  /** Bars since the condition that created the current setup appeared. */
  setupAgeBars: number | null;

  entry: number | null;
  retestLevel: number | null;
  stops: StopLevel[];
  target1: number | null;
  target2: number | null;
  runnerTarget: number | null;
  riskPct: number | null;
  rewardPct: number | null;
  riskReward: number | null;

  reasons: string[]; // WHY THIS SETUP (≤5)
  invalidators: string[]; // WHAT INVALIDATES IT (≤4)
}

// ------------------------------------------------------------------ helpers

function smaAt(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i]!;
  return s / period;
}

/** ISO-week resample of daily candles into weekly bars. Deterministic. */
export function resampleWeekly(daily: Candle[]): Candle[] {
  const weeks = new Map<string, Candle>();
  for (const c of daily) {
    const d = new Date(c.date + "T00:00:00Z");
    // ISO week key
    const t = new Date(d);
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
    const key = `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
    const w = weeks.get(key);
    if (!w) {
      weeks.set(key, { ...c });
    } else {
      w.high = Math.max(w.high, c.high);
      w.low = Math.min(w.low, c.low);
      w.close = c.close;
      w.volume = (w.volume ?? 0) + (c.volume ?? 0);
      w.date = c.date; // week labeled by its last bar
    }
  }
  return [...weeks.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function realizedVol(candles: Candle[], lookback = 20): number | null {
  if (candles.length < lookback + 1) return null;
  const rets: number[] = [];
  for (let i = candles.length - lookback; i < candles.length; i++) {
    const prev = candles[i - 1]!.close;
    if (prev > 0) rets.push(Math.log(candles[i]!.close / prev));
  }
  if (rets.length < 5) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(varr) * Math.sqrt(252) * 100;
}

function momentumState(candles: Candle[], ma50: number | null, a: number | null): MomentumState {
  const n = candles.length;
  if (n < 21) return "FLAT";
  const price = candles[n - 1]!.close;
  const roc20 = (price - candles[n - 21]!.close) / candles[n - 21]!.close;
  const distMa = ma50 !== null && a !== null && a > 0 ? (price - ma50) / a : null;
  if (distMa !== null && distMa > 4) return "EXTENDED";
  if (roc20 > 0.12) return "STRONG_UP";
  if (roc20 > 0.03) return "UP";
  if (roc20 < -0.12) return "STRONG_DOWN";
  if (roc20 < -0.03) return "DOWN";
  return "FLAT";
}

function volumeState(candles: Candle[]): VolumeState {
  const vols = candles.map((c) => c.volume ?? 0).filter((v) => v > 0);
  if (vols.length < 60) return "NORMAL";
  const v20 = smaAt(vols, 20)!;
  const v60 = smaAt(vols, 60)!;
  if (v60 <= 0) return "NORMAL";
  const r = v20 / v60;
  return r > 1.2 ? "EXPANDING" : r < 0.8 ? "CONTRACTING" : "NORMAL";
}

const round2 = (v: number) => Number(v.toFixed(2));

// ------------------------------------------------------------------- engine

export function buildTechnicalDecision(symbol: string, dailyCandles: Candle[]): TechnicalDecision {
  const daily = buildTechnicalMap(symbol, dailyCandles);
  const weeklyCandles = resampleWeekly(dailyCandles);
  const weekly = buildTechnicalMap(symbol, weeklyCandles);

  const closes = dailyCandles.map((c) => c.close);
  const ma20 = smaAt(closes, 20);
  const a = daily.atr14;
  const price = daily.price;

  const base: TechnicalDecision = {
    symbol,
    asOf: daily.asOf,
    price,
    daily,
    weeklyTrend: weekly.trend,
    weeklyPrimarySupport: weekly.primarySupport,
    weeklyPrimaryResistance: weekly.primaryResistance,
    ma20,
    momentum: momentumState(dailyCandles, daily.ma50, a),
    volumeState: volumeState(dailyCandles),
    realizedVolAnnualPct: realizedVol(dailyCandles),
    signal: "INSUFFICIENT_DATA",
    setup: "NONE",
    counterTrend: false,
    score: null,
    confidence: "LOW",
    freshness: "EXPIRED",
    setupAgeBars: null,
    entry: null,
    retestLevel: null,
    stops: [],
    target1: null,
    target2: null,
    runnerTarget: null,
    riskPct: null,
    rewardPct: null,
    riskReward: null,
    reasons: [],
    invalidators: [],
  };

  if (daily.state === "INSUFFICIENT_DATA" || a === null || price <= 0) return base;

  // ------------------------------------------------------ setup classification
  const distSup = daily.primarySupport !== null ? (price - daily.primarySupport) / a : null;
  const distRes = daily.primaryResistance !== null ? (daily.primaryResistance - price) / a : null;
  const distMa50 = daily.ma50 !== null ? Math.abs(price - daily.ma50) / a : null;
  const distVwap = daily.anchoredVwap !== null ? Math.abs(price - daily.anchoredVwap) / a : null;
  const nearMajorSup =
    daily.majorSupport !== null ? Math.abs(price - daily.majorSupport) / a <= 1.2 : false;
  const bullDaily = daily.trend === "UPTREND" || daily.trend === "RECOVERY";
  const bearDaily = daily.trend === "DOWNTREND" || daily.trend === "BREAKDOWN";
  const roc5 =
    dailyCandles.length > 6
      ? (price - dailyCandles[dailyCandles.length - 6]!.close) /
        dailyCandles[dailyCandles.length - 6]!.close
      : 0;

  // Recent-breakout detection: did price close above the CURRENT primary
  // resistance within the last 10 bars and is it now above it?
  let breakoutBarsAgo: number | null = null;
  if (daily.primaryResistance !== null) {
    for (let back = 1; back <= 10 && back < dailyCandles.length; back++) {
      const c = dailyCandles[dailyCandles.length - back]!;
      if (c.close > daily.primaryResistance) breakoutBarsAgo = back - 1;
    }
  }

  let setup: SetupType = "NONE";
  let setupAge: number | null = null;

  if (bearDaily && distRes !== null && distRes <= 1) {
    setup = "MAJOR_RESISTANCE_REJECTION";
  } else if (
    daily.trend === "BREAKDOWN" ||
    (daily.primarySupport !== null && price < daily.primarySupport)
  ) {
    setup = "SUPPORT_BREAKDOWN";
  } else if (breakoutBarsAgo !== null && price > (daily.primaryResistance ?? Infinity)) {
    // Above the old ceiling. Fresh = breakout; pulled back near it = retest.
    const nearLine = (price - daily.primaryResistance!) / a <= 0.8;
    setup = nearLine && breakoutBarsAgo >= 2 ? "BREAKOUT_RETEST" : "BREAKOUT";
    setupAge = breakoutBarsAgo;
  } else if (bullDaily && distSup !== null && distSup <= 1.2) {
    setup = nearMajorSup ? "MAJOR_SUPPORT_REVERSAL" : "SUPPORT_BOUNCE";
  } else if (bullDaily && distMa50 !== null && distMa50 <= 0.7 && price >= (daily.ma50 ?? 0)) {
    setup = "MA50_RETEST";
  } else if (bullDaily && distVwap !== null && distVwap <= 0.7) {
    setup = "PULLBACK_TO_VWAP";
  } else if (daily.trend === "RANGE" && distSup !== null && distSup <= 1) {
    setup = "SUPPORT_BOUNCE";
  } else if (bullDaily && base.momentum !== "EXTENDED" && distRes !== null && distRes > 2) {
    setup = "TREND_CONTINUATION";
  } else if (daily.trend === "RECOVERY" && roc5 > 0.02 && distSup !== null && distSup <= 3) {
    setup = "OVERSOLD_RECOVERY";
  }

  // Age: for level-anchored setups use bars since the anchoring pivot.
  if (setupAge === null && setup !== "NONE") {
    const anchor = daily.supports.find((l) => l.rank === "PRIMARY")?.lastTouch;
    if (anchor) {
      const idx = dailyCandles.findIndex((c) => c.date === anchor);
      if (idx >= 0) setupAge = dailyCandles.length - 1 - idx;
    }
  }

  // ------------------------------------------------------------- stop ladder
  const stops: StopLevel[] = [];
  const structuralRef =
    setup === "BREAKOUT" || setup === "BREAKOUT_RETEST"
      ? daily.primaryResistance // broken ceiling becomes the floor being defended
      : daily.primarySupport;
  if (structuralRef !== null) {
    const ladder: Array<[StopLevel["kind"], number, string]> = [
      ["TIGHT", 0.4, "Just below the defended level + 0.4 ATR noise buffer"],
      ["STANDARD", 0.8, "Below structural level + 0.8 ATR buffer"],
    ];
    for (const [kind, buf, reason] of ladder) {
      const p = round2(structuralRef - buf * a);
      if (p > 0 && p < price) {
        stops.push({
          kind,
          price: p,
          riskPct: round2(((price - p) / price) * 100),
          atrDistance: round2((price - p) / a),
          reason,
        });
      }
    }
    const wideRef = daily.majorSupport ?? structuralRef;
    const wideP = round2(wideRef - 1.0 * a);
    if (wideP > 0 && wideP < price && !stops.some((s) => Math.abs(s.price - wideP) < 0.01)) {
      stops.push({
        kind: "WIDE",
        price: wideP,
        riskPct: round2(((price - wideP) / price) * 100),
        atrDistance: round2((price - wideP) / a),
        reason: "Below major structure + 1.0 ATR — survives normal shakeouts",
      });
    }
  }
  const standardStop = stops.find((s) => s.kind === "STANDARD") ?? stops[0] ?? null;

  // ----------------------------------------------------------------- targets
  const target1 = daily.primaryResistance;
  const target2 =
    daily.majorResistance !== null && daily.majorResistance !== daily.primaryResistance
      ? daily.majorResistance
      : daily.secondaryResistance;
  // Runner: measured move — height of the recent structure projected above the
  // breakout line. Only for breakout-family setups (structural, not invented).
  let runnerTarget: number | null = null;
  if ((setup === "BREAKOUT" || setup === "BREAKOUT_RETEST") && daily.primaryResistance !== null && daily.primarySupport !== null) {
    const height = daily.primaryResistance - daily.primarySupport;
    if (height > 0) runnerTarget = round2(daily.primaryResistance + height);
  }

  // ------------------------------------------------------- entry, R/R, retest
  const entry =
    setup === "BREAKOUT" || setup === "BREAKOUT_RETEST"
      ? round2(Math.max(price, (daily.primaryResistance ?? price) * 1.001))
      : daily.primarySupport !== null && distSup !== null && distSup <= 1.2
        ? round2(Math.max(daily.primarySupport * 1.002, price * 0.995))
        : setup === "MA50_RETEST" && daily.ma50 !== null
          ? round2(daily.ma50)
          : setup === "PULLBACK_TO_VWAP" && daily.anchoredVwap !== null
            ? round2(daily.anchoredVwap)
            : null;
  const retestLevel =
    setup === "BREAKOUT" || setup === "BREAKOUT_RETEST" ? daily.primaryResistance : daily.primarySupport;

  let riskPct: number | null = null;
  let rewardPct: number | null = null;
  let rr: number | null = null;
  const t1 = setup === "BREAKOUT" || setup === "BREAKOUT_RETEST" ? (target2 ?? runnerTarget) : target1;
  if (entry !== null && standardStop !== null && t1 !== null && entry > standardStop.price && t1 > entry) {
    riskPct = round2(((entry - standardStop.price) / entry) * 100);
    rewardPct = round2(((t1 - entry) / entry) * 100);
    rr = round2(rewardPct / riskPct);
  }

  // -------------------------------------------------------------- MTF + score
  const weeklyBull = weekly.trend === "UPTREND" || weekly.trend === "RECOVERY";
  const weeklyBear = weekly.trend === "DOWNTREND" || weekly.trend === "BREAKDOWN";
  const counterTrend = (bullDaily && weeklyBear) || (bearDaily && weeklyBull);

  const trendScore =
    daily.trend === "UPTREND" ? 90 : daily.trend === "RECOVERY" ? 70 : daily.trend === "RANGE" ? 50 : 20;
  const structScore = Math.min(100, daily.supports.find((l) => l.rank === "PRIMARY")?.score ?? 30);
  const momScore =
    base.momentum === "STRONG_UP" ? 85
    : base.momentum === "UP" ? 70
    : base.momentum === "EXTENDED" ? 45
    : base.momentum === "FLAT" ? 50
    : base.momentum === "DOWN" ? 30 : 15;
  const volScore = base.volumeState === "EXPANDING" ? 80 : base.volumeState === "NORMAL" ? 55 : 35;
  const mtfScore = counterTrend ? 25 : weeklyBull === bullDaily ? 90 : 55;
  const rrScore = rr === null ? 40 : rr >= 3 ? 95 : rr >= 2 ? 85 : rr >= 1.5 ? 65 : rr >= 1 ? 45 : 20;

  const weights = { trend: 0.22, structure: 0.2, momentum: 0.15, volume: 0.13, multiTimeframe: 0.15, riskReward: 0.15 };
  const total = Math.round(
    trendScore * weights.trend +
    structScore * weights.structure +
    momScore * weights.momentum +
    volScore * weights.volume +
    mtfScore * weights.multiTimeframe +
    rrScore * weights.riskReward,
  );
  const score: ScoreBreakdown = {
    trend: trendScore,
    structure: structScore,
    momentum: momScore,
    volume: volScore,
    multiTimeframe: mtfScore,
    riskReward: rrScore,
    weights,
    total,
  };

  // ------------------------------------------------------------------ signal
  let signal: SignalState = "WAIT";
  const bullishSetup = [
    "SUPPORT_BOUNCE", "BREAKOUT", "BREAKOUT_RETEST", "TREND_CONTINUATION",
    "PULLBACK_TO_VWAP", "MA50_RETEST", "MAJOR_SUPPORT_REVERSAL", "OVERSOLD_RECOVERY",
  ].includes(setup);

  if (daily.invalidation !== null && price < daily.invalidation) {
    signal = "INVALIDATED";
  } else if (setup === "SUPPORT_BREAKDOWN") {
    signal = "SELL";
  } else if (setup === "MAJOR_RESISTANCE_REJECTION") {
    signal = "REDUCE";
  } else if (bullishSetup) {
    if (counterTrend) signal = "TACTICAL_BUY";
    else if (setup === "BREAKOUT") signal = "BREAKOUT_BUY";
    else if (setup === "BREAKOUT_RETEST") signal = "BUY_ON_RETEST";
    else if (rr !== null && rr >= 2 && total >= 75 && structScore >= 55) signal = "STRONG_BUY";
    else if (rr !== null && rr >= 1.3 && total >= 60) signal = "BUY";
    else if (distSup !== null && distSup <= 2.5) signal = "WATCHING_FOR_ENTRY";
    else signal = "WAIT";
  } else if (daily.state === "BREAKOUT_PENDING") {
    signal = "BREAKOUT_PENDING";
  } else if (daily.trend === "BREAKDOWN") {
    signal = "RETEST_REQUIRED";
  }

  // --------------------------------------------------------------- freshness
  let freshness: Freshness = "EXPIRED";
  if (signal !== "WAIT" && setup !== "NONE") {
    if (setupAge === null) freshness = "ACTIVE";
    else if (setupAge <= 2) freshness = "NEW";
    else if (setupAge <= 10) freshness = "ACTIVE";
    else if (setupAge <= 20) freshness = "WEAKENING";
    else freshness = "EXPIRED";
  }
  if (freshness === "EXPIRED" && (signal === "BREAKOUT_BUY" || signal === "STRONG_BUY" || signal === "BUY")) {
    // A stale setup may not keep shouting BUY (spec §12).
    signal = "WATCHING_FOR_ENTRY";
  }

  const confidence: TechnicalDecision["confidence"] =
    counterTrend ? "LOW"
    : total >= 75 && structScore >= 55 && freshness !== "WEAKENING" ? "HIGH"
    : total >= 55 ? "MEDIUM" : "LOW";

  // ------------------------------------------------------------ explanations
  const reasons: string[] = [];
  if (setup !== "NONE") reasons.push(`Setup: ${setup.replaceAll("_", " ").toLowerCase()}`);
  if (daily.primarySupport !== null && distSup !== null)
    reasons.push(`Price ${distSup.toFixed(1)} ATR above primary support ${daily.primarySupport}`);
  if (weeklyBull) reasons.push("Weekly structure bullish");
  if (base.volumeState === "EXPANDING") reasons.push("Volume expanding vs 60-day average");
  if (rr !== null) reasons.push(`R:R ${rr} to ${t1 !== null ? "structural target " + t1 : "target"}`);
  if (counterTrend) reasons.push("COUNTER-TREND: weekly disagrees with daily — tactical only");

  const invalidators: string[] = [];
  if (daily.invalidation !== null) invalidators.push(`Daily close below ${daily.invalidation} (structural invalidation)`);
  if (standardStop) invalidators.push(`Standard stop ${standardStop.price} (${standardStop.reason})`);
  if (setup === "BREAKOUT" && daily.primaryResistance !== null)
    invalidators.push(`Close back below ${daily.primaryResistance} = failed breakout`);
  if (weeklyBear) invalidators.push("Weekly regime turning further down");

  return {
    ...base,
    signal,
    setup,
    counterTrend,
    score,
    confidence,
    freshness,
    setupAgeBars: setupAge,
    entry,
    retestLevel,
    stops,
    target1,
    target2,
    runnerTarget,
    riskPct,
    rewardPct,
    riskReward: rr,
    reasons: reasons.slice(0, 5),
    invalidators: invalidators.slice(0, 4),
  };
}
