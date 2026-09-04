import type { Candle } from "@/lib/types";
import { buildTechnicalDecision, type ScoreBreakdown, type SetupType, type TechnicalDecision } from "./technical-v3";

/**
 * Technical Backtest Engine (spec §16).
 *
 * Signal-seam architecture (adapted from MIT-licensed maverick-mcp's
 * vectorbt engine design: signal generation is separated from outcome
 * measurement; this module only measures). LOOK-AHEAD PREVENTION is
 * structural: the detector receives candles.slice(0, i+1) and nothing else.
 * The look-ahead test in engines suite verifies bar-i output is identical
 * when all future bars are replaced with garbage.
 */

export interface SetupOutcome {
  setup: SetupType;
  entryDate: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  exit: "TARGET" | "STOP" | "TIMEOUT";
  exitDate: string;
  barsHeld: number;
  returnPct: number;
  mfePct: number; // max favorable excursion
  maePct: number; // max adverse excursion
  atrNormalizedReturn: number | null;
  /** Score components AT DETECTION — captured for weight calibration only. */
  score?: ScoreBreakdown | null;
}

export interface SetupStats {
  setup: SetupType;
  samples: number;
  target1HitRate: number | null;
  stopHitRate: number | null;
  timeoutRate: number | null;
  medianReturnPct: number | null;
  meanMfePct: number | null;
  meanMaePct: number | null;
  medianBarsHeld: number | null;
  verdict: "USABLE" | "INSUFFICIENT_DATA";
}

const MIN_SAMPLES = 15;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export interface BacktestOptions {
  /** Evaluate a detection only every N bars (decorrelates samples). */
  stride?: number;
  /** Max bars a position may be held before TIMEOUT. */
  horizon?: number;
  /** Minimum history the detector needs before the first evaluation. */
  warmup?: number;
  /** Which setups count as entries. */
  bullishOnly?: boolean;
}

/**
 * Walk the history; at each evaluation bar run the detector on PAST DATA ONLY;
 * when it yields an actionable bullish setup with entry/stop/target, measure
 * the forward outcome. Overlapping positions are skipped (one at a time),
 * which mirrors how the signal would be traded and decorrelates outcomes.
 */
export function backtestSetups(
  symbol: string,
  candles: Candle[],
  opts: BacktestOptions = {},
): SetupOutcome[] {
  const stride = opts.stride ?? 3;
  const horizon = opts.horizon ?? 40;
  const warmup = opts.warmup ?? 220;
  const outcomes: SetupOutcome[] = [];
  let busyUntil = -1;

  for (let i = warmup; i < candles.length - 2; i += stride) {
    if (i <= busyUntil) continue;
    const visible = candles.slice(0, i + 1); // ← the whole anti-look-ahead story
    const d: TechnicalDecision = buildTechnicalDecision(symbol, visible);

    const actionable =
      ["STRONG_BUY", "BUY", "BREAKOUT_BUY", "BUY_ON_RETEST", "TACTICAL_BUY"].includes(d.signal) &&
      d.entry !== null &&
      d.stops.length > 0 &&
      (d.target1 !== null || d.target2 !== null);
    if (!actionable) continue;
    if (opts.bullishOnly === false) {
      // (bearish measurement not implemented yet — spec allows independent setups)
    }

    const stop = (d.stops.find((s) => s.kind === "STANDARD") ?? d.stops[0])!;
    const target = (d.setup === "BREAKOUT" || d.setup === "BREAKOUT_RETEST"
      ? (d.target2 ?? d.runnerTarget ?? d.target1)
      : d.target1)!;
    // Entries execute at the NEXT bar's open (no same-bar fill fantasy).
    const entryBar = candles[i + 1]!;
    const entryPrice = entryBar.open;
    if (!(entryPrice > stop.price && target > entryPrice)) continue;

    let exit: SetupOutcome["exit"] = "TIMEOUT";
    let exitIdx = Math.min(i + horizon, candles.length - 1);
    let mfe = 0;
    let mae = 0;
    for (let j = i + 1; j <= Math.min(i + horizon, candles.length - 1); j++) {
      const c = candles[j]!;
      mfe = Math.max(mfe, (c.high - entryPrice) / entryPrice);
      mae = Min(mae, (c.low - entryPrice) / entryPrice);
      // Conservative same-bar rule: if both stop and target are inside one
      // bar's range, count the STOP first (worst case, never flattering).
      if (c.low <= stop.price) {
        exit = "STOP";
        exitIdx = j;
        break;
      }
      if (c.high >= target) {
        exit = "TARGET";
        exitIdx = j;
        break;
      }
    }
    const exitPrice = exit === "STOP" ? stop.price : exit === "TARGET" ? target : candles[exitIdx]!.close;
    const atrNow = d.daily.atr14;
    outcomes.push({
      setup: d.setup,
      entryDate: entryBar.date,
      entryPrice,
      stopPrice: stop.price,
      targetPrice: target,
      exit,
      exitDate: candles[exitIdx]!.date,
      barsHeld: exitIdx - i,
      returnPct: ((exitPrice - entryPrice) / entryPrice) * 100,
      mfePct: mfe * 100,
      maePct: mae * 100,
      atrNormalizedReturn: atrNow && atrNow > 0 ? (exitPrice - entryPrice) / atrNow : null,
      score: d.score,
    });
    busyUntil = exitIdx;
  }
  return outcomes;
}

function Min(a: number, b: number): number {
  return a < b ? a : b;
}

export function aggregateStats(outcomes: SetupOutcome[]): SetupStats[] {
  const bySetup = new Map<SetupType, SetupOutcome[]>();
  for (const o of outcomes) {
    const arr = bySetup.get(o.setup) ?? [];
    arr.push(o);
    bySetup.set(o.setup, arr);
  }
  const out: SetupStats[] = [];
  for (const [setup, arr] of bySetup) {
    const n = arr.length;
    if (n < MIN_SAMPLES) {
      out.push({
        setup, samples: n,
        target1HitRate: null, stopHitRate: null, timeoutRate: null,
        medianReturnPct: null, meanMfePct: null, meanMaePct: null,
        medianBarsHeld: null, verdict: "INSUFFICIENT_DATA",
      });
      continue;
    }
    const hit = arr.filter((o) => o.exit === "TARGET").length / n;
    const stopped = arr.filter((o) => o.exit === "STOP").length / n;
    out.push({
      setup,
      samples: n,
      target1HitRate: Number((hit * 100).toFixed(1)),
      stopHitRate: Number((stopped * 100).toFixed(1)),
      timeoutRate: Number(((1 - hit - stopped) * 100).toFixed(1)),
      medianReturnPct: Number((median(arr.map((o) => o.returnPct)) ?? 0).toFixed(2)),
      meanMfePct: Number((arr.reduce((a, o) => a + o.mfePct, 0) / n).toFixed(2)),
      meanMaePct: Number((arr.reduce((a, o) => a + o.maePct, 0) / n).toFixed(2)),
      medianBarsHeld: median(arr.map((o) => o.barsHeld)),
      verdict: "USABLE",
    });
  }
  return out.sort((a, b) => b.samples - a.samples);
}
