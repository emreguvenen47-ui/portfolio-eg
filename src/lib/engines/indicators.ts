import type { Candle } from "@/lib/types";

/**
 * INDICATOR MATH — pure, deterministic, provider-free. Every function returns
 * one value per input candle aligned by index, with `null` for warm-up bars —
 * never a fabricated value. These are the ONLY indicator implementations; the
 * chart, the analyze report and the NL command layer all call the same math.
 */

export interface IndPoint {
  time: string;
  value: number | null;
}

const toPoints = (candles: Candle[], values: Array<number | null>): IndPoint[] =>
  candles.map((c, i) => ({ time: c.date, value: values[i] ?? null }));

export function smaSeries(candles: Candle[], period: number): IndPoint[] {
  const out: Array<number | null> = new Array(candles.length).fill(null);
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i]!.close;
    if (i >= period) sum -= candles[i - period]!.close;
    if (i >= period - 1) out[i] = sum / period;
  }
  return toPoints(candles, out);
}

export function emaSeries(candles: Candle[], period: number): IndPoint[] {
  const out: Array<number | null> = new Array(candles.length).fill(null);
  const k = 2 / (period + 1);
  let ema: number | null = null;
  let seed = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!.close;
    if (i < period - 1) {
      seed += c;
      continue;
    }
    if (i === period - 1) {
      ema = (seed + c) / period;
    } else {
      ema = c * k + (ema as number) * (1 - k);
    }
    out[i] = ema;
  }
  return toPoints(candles, out);
}

export function rsiSeries(candles: Candle[], period = 14): IndPoint[] {
  const out: Array<number | null> = new Array(candles.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < candles.length; i++) {
    const ch = candles[i]!.close - candles[i - 1]!.close;
    const gain = Math.max(0, ch);
    const loss = Math.max(0, -ch);
    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      if (i === period) out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return toPoints(candles, out);
}

export interface MacdPoint {
  time: string;
  macd: number | null;
  signal: number | null;
  histogram: number | null;
}

export function macdSeries(candles: Candle[], fast = 12, slow = 26, signalPeriod = 9): MacdPoint[] {
  const fastE = emaSeries(candles, fast);
  const slowE = emaSeries(candles, slow);
  const macdLine: Array<number | null> = candles.map((_, i) => {
    const f = fastE[i]!.value;
    const s = slowE[i]!.value;
    return f !== null && s !== null ? f - s : null;
  });
  // Signal: EMA of the macd line, seeded on the first `signalPeriod` values.
  const sig: Array<number | null> = new Array(candles.length).fill(null);
  const k = 2 / (signalPeriod + 1);
  let ema: number | null = null;
  let warm: number[] = [];
  for (let i = 0; i < macdLine.length; i++) {
    const v = macdLine[i];
    if (v === null) continue;
    if (ema === null) {
      warm.push(v);
      if (warm.length === signalPeriod) {
        ema = warm.reduce((a, b) => a + b, 0) / signalPeriod;
        sig[i] = ema;
      }
      continue;
    }
    ema = v * k + ema * (1 - k);
    sig[i] = ema;
  }
  return candles.map((c, i) => ({
    time: c.date,
    macd: macdLine[i] ?? null,
    signal: sig[i] ?? null,
    histogram: macdLine[i] !== null && sig[i] !== null ? (macdLine[i] as number) - (sig[i] as number) : null,
  }));
}

export interface BandPoint {
  time: string;
  upper: number | null;
  middle: number | null;
  lower: number | null;
}

export function bollingerSeries(candles: Candle[], period = 20, mult = 2): BandPoint[] {
  const out: BandPoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      out.push({ time: candles[i]!.date, upper: null, middle: null, lower: null });
      continue;
    }
    const win = candles.slice(i - period + 1, i + 1).map((c) => c.close);
    const mean = win.reduce((a, b) => a + b, 0) / period;
    const sd = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    out.push({
      time: candles[i]!.date,
      upper: mean + mult * sd,
      middle: mean,
      lower: mean - mult * sd,
    });
  }
  return out;
}

export function atrSeries(candles: Candle[], period = 14): IndPoint[] {
  const out: Array<number | null> = new Array(candles.length).fill(null);
  let atr: number | null = null;
  let seed = 0;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prev = candles[i - 1]!;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
    if (i <= period) {
      seed += tr;
      if (i === period) {
        atr = seed / period;
        out[i] = atr;
      }
    } else {
      atr = ((atr as number) * (period - 1) + tr) / period;
      out[i] = atr;
    }
  }
  return toPoints(candles, out);
}

/** Session-anchored VWAP is meaningless on daily bars; this is a rolling
 * cumulative VWAP anchored at the first visible bar — stated as such. */
export function vwapSeries(candles: Candle[]): IndPoint[] {
  const out: Array<number | null> = new Array(candles.length).fill(null);
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const typical = (c.high + c.low + c.close) / 3;
    const v = c.volume ?? 0;
    pv += typical * v;
    vol += v;
    out[i] = vol > 0 ? pv / vol : null;
  }
  return toPoints(candles, out);
}

export function obvSeries(candles: Candle[]): IndPoint[] {
  const out: Array<number | null> = new Array(candles.length).fill(null);
  let obv = 0;
  out[0] = 0;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prev = candles[i - 1]!;
    const v = c.volume ?? 0;
    if (c.close > prev.close) obv += v;
    else if (c.close < prev.close) obv -= v;
    out[i] = obv;
  }
  return toPoints(candles, out);
}

export interface StochPoint {
  time: string;
  k: number | null;
  d: number | null;
}

export function stochasticSeries(candles: Candle[], kPeriod = 14, dPeriod = 3): StochPoint[] {
  const kArr: Array<number | null> = new Array(candles.length).fill(null);
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const win = candles.slice(i - kPeriod + 1, i + 1);
    const hh = Math.max(...win.map((c) => c.high));
    const ll = Math.min(...win.map((c) => c.low));
    kArr[i] = hh === ll ? 50 : ((candles[i]!.close - ll) / (hh - ll)) * 100;
  }
  const out: StochPoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    let d: number | null = null;
    if (i >= kPeriod - 1 + dPeriod - 1) {
      const win = kArr.slice(i - dPeriod + 1, i + 1).filter((v): v is number => v !== null);
      if (win.length === dPeriod) d = win.reduce((a, b) => a + b, 0) / dPeriod;
    }
    out.push({ time: candles[i]!.date, k: kArr[i] ?? null, d });
  }
  return out;
}

// ------------------------------------------------------------ swings & fibs

export interface Swing {
  kind: "HIGH" | "LOW";
  index: number;
  date: string;
  price: number;
}

/** Pivot swings: a bar whose high/low is the extreme of ±`width` neighbors. */
export function findSwings(candles: Candle[], width = 5): Swing[] {
  const swings: Swing[] = [];
  for (let i = width; i < candles.length - width; i++) {
    const c = candles[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - width; j <= i + width; j++) {
      if (j === i) continue;
      if (candles[j]!.high >= c.high) isHigh = false;
      if (candles[j]!.low <= c.low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) swings.push({ kind: "HIGH", index: i, date: c.date, price: c.high });
    if (isLow) swings.push({ kind: "LOW", index: i, date: c.date, price: c.low });
  }
  return swings;
}

export interface FibLevels {
  swingHigh: Swing;
  swingLow: Swing;
  direction: "UP" | "DOWN"; // UP = low precedes high (retracements below high)
  retracements: Array<{ ratio: number; price: number }>;
  extensions: Array<{ ratio: number; price: number }>;
}

const RETRACE = [0.236, 0.382, 0.5, 0.618, 0.786];
const EXTEND = [1.272, 1.618, 2.0];

/** Fibonacci for the most recent MEANINGFUL swing (largest range in window). */
export function fibonacciFromSwings(candles: Candle[], lookback = 253): FibLevels | null {
  const win = candles.slice(-lookback);
  const offset = candles.length - win.length;
  const swings = findSwings(win, 5).map((s) => ({ ...s, index: s.index + offset }));
  if (swings.length < 2) return null;
  // Pick the high/low pair with the largest price range among recent swings.
  let best: { hi: Swing; lo: Swing } | null = null;
  for (const a of swings) {
    for (const b of swings) {
      if (a.kind !== "HIGH" || b.kind !== "LOW") continue;
      const range = a.price - b.price;
      if (range <= 0) continue;
      if (!best || range > best.hi.price - best.lo.price) best = { hi: a, lo: b };
    }
  }
  if (!best) return null;
  const { hi, lo } = best;
  const direction: "UP" | "DOWN" = lo.index < hi.index ? "UP" : "DOWN";
  const range = hi.price - lo.price;
  const retracements = RETRACE.map((r) => ({
    ratio: r,
    price: direction === "UP" ? hi.price - range * r : lo.price + range * r,
  }));
  const extensions = EXTEND.map((r) => ({
    ratio: r,
    price: direction === "UP" ? lo.price + range * r : hi.price - range * r,
  }));
  return { swingHigh: hi, swingLow: lo, direction, retracements, extensions };
}
