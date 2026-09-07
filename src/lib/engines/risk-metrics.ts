import type { Candle } from "@/lib/types";

/**
 * PER-STOCK RISK PROFILE — volatility, beta, drawdown, VaR, liquidity and a
 * risk-based position size. Metric set adapted from MIT-licensed
 * stock-analysis-mcp (nickzren) `risk_metrics`; every formula reimplemented
 * here on our own candle series. Deterministic arithmetic on observed prices —
 * no forecast, no simulation. Null always means "insufficient data".
 */

export interface RiskProfile {
  asOf: string;
  bars: number;
  /** Annualized realized volatility from daily log returns, %. */
  realizedVolPct: number | null;
  /** Regression beta vs the benchmark (overlapping daily returns, ≥120 obs). */
  beta: number | null;
  betaBenchmark: string;
  /** Correlation with the benchmark over the same window. */
  correlation: number | null;
  /** Deepest peak-to-trough over the window, %. Negative. */
  maxDrawdownPct: number | null;
  /** Where price sits vs its running peak right now, %. Negative or 0. */
  currentDrawdownPct: number | null;
  /** 1-day historical VaR at 95% / 99% (return percentile), %. Negative. */
  var95Pct: number | null;
  var99Pct: number | null;
  /** Average daily traded value over ~20 sessions, USD. */
  avgDollarVolume: number | null;
  /** ATR(14) as % of price. */
  atrPct: number | null;
  /**
   * Position-sizing math, stated not prescribed: shares such that a stop
   * `stopDistancePct` away loses exactly 1% of a $100k account — scale
   * linearly for any account. Null when the stop distance is unknown.
   */
  sizingNote: string | null;
}

const logReturns = (candles: Candle[]): number[] => {
  const out: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const a = candles[i - 1]!.close;
    const b = candles[i]!.close;
    if (a > 0 && b > 0) out.push(Math.log(b / a));
  }
  return out;
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length < 60) return null;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * sorted.length)));
  return sorted[idx]!;
}

export function buildRiskProfile(
  candles: Candle[],
  benchmark: Candle[] | null,
  opts: { stopDistancePct?: number | null; benchmarkLabel?: string } = {},
): RiskProfile | null {
  if (candles.length < 60) return null;
  const window = candles.slice(-504); // ~2y
  const rets = logReturns(window);
  const last = window[window.length - 1]!;

  // Realized vol
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varc = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  const realizedVolPct = rets.length >= 60 ? Math.sqrt(varc * 252) * 100 : null;

  // Beta / correlation vs benchmark on date-aligned overlapping returns.
  let beta: number | null = null;
  let correlation: number | null = null;
  if (benchmark && benchmark.length >= 120) {
    const bByDate = new Map(benchmark.map((c) => [c.date, c.close]));
    const pairs: Array<[number, number]> = [];
    for (let i = 1; i < window.length; i++) {
      const d0 = window[i - 1]!.date;
      const d1 = window[i]!.date;
      const b0 = bByDate.get(d0);
      const b1 = bByDate.get(d1);
      if (b0 && b1 && b0 > 0 && window[i - 1]!.close > 0) {
        pairs.push([Math.log(window[i]!.close / window[i - 1]!.close), Math.log(b1 / b0)]);
      }
    }
    if (pairs.length >= 120) {
      const mx = pairs.reduce((a, p) => a + p[1], 0) / pairs.length;
      const my = pairs.reduce((a, p) => a + p[0], 0) / pairs.length;
      let cov = 0;
      let vb = 0;
      let vs = 0;
      for (const [y, x] of pairs) {
        cov += (x - mx) * (y - my);
        vb += (x - mx) ** 2;
        vs += (y - my) ** 2;
      }
      if (vb > 0) beta = cov / vb;
      if (vb > 0 && vs > 0) correlation = cov / Math.sqrt(vb * vs);
    }
  }

  // Drawdowns
  let peak = -Infinity;
  let maxDd = 0;
  for (const c of window) {
    peak = Math.max(peak, c.close);
    maxDd = Math.min(maxDd, c.close / peak - 1);
  }
  const currentDd = peak > 0 ? last.close / peak - 1 : null;

  // Historical VaR
  const sorted = [...rets].sort((a, b) => a - b);
  const var95 = percentile(sorted, 0.05);
  const var99 = percentile(sorted, 0.01);

  // Liquidity
  const last20 = window.slice(-20);
  const advRaw = last20.reduce((a, c) => a + (c.volume ?? 0) * c.close, 0) / Math.max(1, last20.length);
  const avgDollarVolume = last20.some((c) => (c.volume ?? 0) > 0) ? advRaw : null;

  // ATR(14) %
  let atr: number | null = null;
  if (window.length >= 15) {
    let acc = 0;
    const start = window.length - 14;
    for (let i = start; i < window.length; i++) {
      const c = window[i]!;
      const p = window[i - 1]!;
      acc += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    }
    atr = acc / 14;
  }
  const atrPct = atr !== null && last.close > 0 ? (atr / last.close) * 100 : null;

  const stopPct = opts.stopDistancePct ?? null;
  const sizingNote =
    stopPct !== null && stopPct > 0 && last.close > 0
      ? (() => {
          const riskBudget = 1000; // 1% of $100k
          const perShareRisk = last.close * (stopPct / 100);
          const shares = Math.floor(riskBudget / perShareRisk);
          return `Risking 1% of a $100k account with the standard stop ${stopPct.toFixed(1)}% away ⇒ ~${shares.toLocaleString()} shares (${(
            (shares * last.close) / 1000
          ).toFixed(1)}k notional). Scale linearly for your account.`;
        })()
      : null;

  return {
    asOf: last.date,
    bars: window.length,
    realizedVolPct: realizedVolPct !== null ? Number(realizedVolPct.toFixed(1)) : null,
    beta: beta !== null ? Number(beta.toFixed(2)) : null,
    betaBenchmark: opts.benchmarkLabel ?? "S&P 500",
    correlation: correlation !== null ? Number(correlation.toFixed(2)) : null,
    maxDrawdownPct: Number((maxDd * 100).toFixed(1)),
    currentDrawdownPct: currentDd !== null ? Number((currentDd * 100).toFixed(1)) : null,
    var95Pct: var95 !== null ? Number((var95 * 100).toFixed(2)) : null,
    var99Pct: var99 !== null ? Number((var99 * 100).toFixed(2)) : null,
    avgDollarVolume,
    atrPct: atrPct !== null ? Number(atrPct.toFixed(2)) : null,
    sizingNote,
  };
}
