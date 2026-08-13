import type { Candle, PositionValuation, Quote } from "@/lib/types";
import type { PortfolioTotals } from "./analytics";

/**
 * Deterministic alert evaluation.
 *
 * Every rule is arithmetic over prices the provider layer already fetched — no
 * model is involved, and none should be: an alert that fires only when a model
 * agrees is not an alert, it is an opinion with a latency and a bill.
 */

export type AlertKind =
  // price
  | "price_above"
  | "price_below"
  | "pct_move"
  | "drawdown_from_high"
  // moving averages
  | "cross_20dma"
  | "cross_50dma"
  | "cross_200dma"
  | "cross_20_50"
  | "cross_50_200"
  // technical
  | "rsi_above"
  | "rsi_below"
  | "breakout_52w"
  | "volume_spike"
  | "volatility_spike"
  // portfolio
  | "weight_above"
  | "weight_below"
  | "portfolio_drawdown"
  | "concentration"
  | "currency_exposure";

export interface AlertRule {
  id: string;
  /** Ticker for market rules; position code or bucket for portfolio rules. */
  subject: string;
  kind: AlertKind;
  /** Threshold, in the unit the rule implies (price, %, ratio, multiple). */
  threshold: number;
  enabled: boolean;
  note?: string;
}

export interface AlertHit {
  ruleId: string;
  subject: string;
  kind: AlertKind;
  triggered: boolean;
  /** Current measured value behind the decision. */
  value: number | null;
  threshold: number;
  detail: string;
  /** Null when the data needed to evaluate it is missing. */
  evaluated: boolean;
}

const sma = (closes: number[], period: number): number | null =>
  closes.length < period
    ? null
    : closes.slice(-period).reduce((a, b) => a + b, 0) / period;

/** Wilder RSI over `period` closes. */
function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Annualised stdev of the last `period` daily returns, in percent. */
function realisedVol(closes: number[], period = 20): number | null {
  if (closes.length < period + 1) return null;
  const rets: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push(closes[i] / closes[i - 1] - 1);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  return Math.sqrt(varr * 252) * 100;
}

/** True when `a` sits above `b` now but did not one bar ago. */
function crossedAbove(a: (number | null)[], b: (number | null)[]): boolean | null {
  const [aPrev, aNow] = a;
  const [bPrev, bNow] = b;
  if (aPrev === null || aNow === null || bPrev === null || bNow === null) return null;
  return aPrev <= bPrev && aNow > bNow;
}

export interface AlertContext {
  quotes: Record<string, Quote | undefined>;
  histories: Record<string, Candle[]>;
  rows: PositionValuation[];
  totals: PortfolioTotals;
  portfolioSeries: { date: string; close: number }[];
}

export function evaluateAlerts(rules: AlertRule[], ctx: AlertContext): AlertHit[] {
  return rules
    .filter((r) => r.enabled)
    .map((rule) => evaluateOne(rule, ctx));
}

function unavailable(rule: AlertRule, why: string): AlertHit {
  return {
    ruleId: rule.id,
    subject: rule.subject,
    kind: rule.kind,
    triggered: false,
    value: null,
    threshold: rule.threshold,
    detail: why,
    evaluated: false,
  };
}

function evaluateOne(rule: AlertRule, ctx: AlertContext): AlertHit {
  const hit = (triggered: boolean, value: number | null, detail: string): AlertHit => ({
    ruleId: rule.id,
    subject: rule.subject,
    kind: rule.kind,
    triggered,
    value,
    threshold: rule.threshold,
    detail,
    evaluated: true,
  });

  // ------------------------------------------------------- portfolio rules
  switch (rule.kind) {
    case "weight_above":
    case "weight_below": {
      const row = ctx.rows.find(
        (r) => r.position.code.toUpperCase() === rule.subject.toUpperCase(),
      );
      if (!row) return unavailable(rule, `${rule.subject} is not a current holding`);
      const w = row.currentWeight * 100;
      const on = rule.kind === "weight_above" ? w > rule.threshold : w < rule.threshold;
      return hit(on, w, `weight ${w.toFixed(1)}% vs ${rule.threshold}%`);
    }
    case "portfolio_drawdown": {
      let peak = -Infinity;
      let dd = 0;
      for (const p of ctx.portfolioSeries) {
        peak = Math.max(peak, p.close);
        if (peak > 0) dd = Math.min(dd, p.close / peak - 1);
      }
      const pct = dd * 100;
      return hit(pct <= -Math.abs(rule.threshold), pct, `drawdown ${pct.toFixed(1)}%`);
    }
    case "concentration": {
      const largest = Math.max(0, ...ctx.rows.map((r) => r.currentWeight)) * 100;
      return hit(largest > rule.threshold, largest, `largest position ${largest.toFixed(1)}%`);
    }
    case "currency_exposure": {
      const pct =
        rule.subject.toUpperCase() === "TRY"
          ? ctx.totals.tryExposurePct * 100
          : ctx.totals.usdExposurePct * 100;
      return hit(pct > rule.threshold, pct, `${rule.subject} exposure ${pct.toFixed(1)}%`);
    }
  }

  // ---------------------------------------------------------- market rules
  const symbol = rule.subject.toUpperCase();
  const quote = ctx.quotes[symbol];
  const candles = ctx.histories[symbol] ?? [];
  const closes = candles.map((c) => c.close).filter((c) => Number.isFinite(c) && c > 0);
  const last = quote?.price ?? closes.at(-1) ?? null;

  if (last === null) return unavailable(rule, `no real price for ${symbol}`);

  switch (rule.kind) {
    case "price_above":
      return hit(last > rule.threshold, last, `${last.toFixed(2)} vs ${rule.threshold}`);
    case "price_below":
      return hit(last < rule.threshold, last, `${last.toFixed(2)} vs ${rule.threshold}`);
    case "pct_move": {
      const pct = quote?.changePercent ?? null;
      if (pct === null) return unavailable(rule, "no daily change available");
      return hit(Math.abs(pct) >= Math.abs(rule.threshold), pct, `daily ${pct.toFixed(2)}%`);
    }
    case "drawdown_from_high": {
      const window = closes.slice(-253);
      if (window.length < 20) return unavailable(rule, "not enough history");
      const high = Math.max(...window);
      const pct = (last / high - 1) * 100;
      return hit(pct <= -Math.abs(rule.threshold), pct, `${pct.toFixed(1)}% from 52w high`);
    }
    case "breakout_52w": {
      const window = closes.slice(-253);
      if (window.length < 20) return unavailable(rule, "not enough history");
      const high = Math.max(...window.slice(0, -1));
      return hit(last > high, last, `${last.toFixed(2)} vs 52w high ${high.toFixed(2)}`);
    }
    case "rsi_above":
    case "rsi_below": {
      const r = rsi(closes);
      if (r === null) return unavailable(rule, "not enough history for RSI");
      const on = rule.kind === "rsi_above" ? r > rule.threshold : r < rule.threshold;
      return hit(on, r, `RSI ${r.toFixed(1)} vs ${rule.threshold}`);
    }
    case "volume_spike": {
      const vols = candles.map((c) => c.volume ?? 0).filter((v) => v > 0);
      if (vols.length < 21) return unavailable(rule, "no volume history");
      const recent = vols.at(-1)!;
      const avg = vols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
      const mult = avg > 0 ? recent / avg : 0;
      return hit(mult >= rule.threshold, mult, `${mult.toFixed(2)}× 20-day average volume`);
    }
    case "volatility_spike": {
      const v = realisedVol(closes);
      if (v === null) return unavailable(rule, "not enough history");
      return hit(v >= rule.threshold, v, `20-day realised vol ${v.toFixed(1)}%`);
    }
    case "cross_20dma":
    case "cross_50dma":
    case "cross_200dma": {
      const period = rule.kind === "cross_20dma" ? 20 : rule.kind === "cross_50dma" ? 50 : 200;
      if (closes.length < period + 1) return unavailable(rule, "not enough history");
      const maNow = sma(closes, period);
      const maPrev = sma(closes.slice(0, -1), period);
      const crossed = crossedAbove([closes.at(-2) ?? null, last], [maPrev, maNow]);
      if (crossed === null || maNow === null) return unavailable(rule, "not enough history");
      const dist = (last / maNow - 1) * 100;
      return hit(crossed, dist, `${dist >= 0 ? "+" : ""}${dist.toFixed(1)}% vs ${period}DMA`);
    }
    case "cross_20_50":
    case "cross_50_200": {
      const [fast, slow] = rule.kind === "cross_20_50" ? [20, 50] : [50, 200];
      if (closes.length < slow + 1) return unavailable(rule, "not enough history");
      const crossed = crossedAbove(
        [sma(closes.slice(0, -1), fast), sma(closes, fast)],
        [sma(closes.slice(0, -1), slow), sma(closes, slow)],
      );
      if (crossed === null) return unavailable(rule, "not enough history");
      const f = sma(closes, fast)!;
      const s = sma(closes, slow)!;
      return hit(
        crossed,
        (f / s - 1) * 100,
        `${fast}DMA ${f.toFixed(2)} vs ${slow}DMA ${s.toFixed(2)}`,
      );
    }
  }

  return unavailable(rule, "unknown rule");
}

/** Compact technical read-out reused by the ticker page. */
export interface TechnicalState {
  state: "BULLISH" | "NEUTRAL" | "BEARISH";
  score: number;
  signals: { label: string; value: string; vote: 1 | 0 | -1 }[];
}

export function technicalState(candles: Candle[], last: number | null): TechnicalState | null {
  const closes = candles.map((c) => c.close).filter((c) => Number.isFinite(c) && c > 0);
  if (closes.length < 60 || last === null) return null;

  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  const r = rsi(closes);
  const window = closes.slice(-253);
  const high = Math.max(...window);
  const ddFromHigh = (last / high - 1) * 100;

  const signals: TechnicalState["signals"] = [];
  const push = (label: string, value: string, vote: 1 | 0 | -1) =>
    signals.push({ label, value, vote });

  if (ma20 !== null) push("Price vs 20DMA", `${((last / ma20 - 1) * 100).toFixed(1)}%`, last > ma20 ? 1 : -1);
  if (ma50 !== null) push("Price vs 50DMA", `${((last / ma50 - 1) * 100).toFixed(1)}%`, last > ma50 ? 1 : -1);
  if (ma200 !== null) push("Price vs 200DMA", `${((last / ma200 - 1) * 100).toFixed(1)}%`, last > ma200 ? 1 : -1);
  if (ma50 !== null && ma200 !== null) {
    push("50/200", ma50 > ma200 ? "Golden Cross regime" : "Death Cross regime", ma50 > ma200 ? 1 : -1);
  }
  if (r !== null) push("RSI(14)", r.toFixed(1), r > 70 ? -1 : r < 30 ? 1 : 0);
  push("From 52w high", `${ddFromHigh.toFixed(1)}%`, ddFromHigh > -5 ? 1 : ddFromHigh < -20 ? -1 : 0);

  const score = signals.reduce((s, x) => s + x.vote, 0);
  return {
    score,
    state: score >= 2 ? "BULLISH" : score <= -2 ? "BEARISH" : "NEUTRAL",
    signals,
  };
}
