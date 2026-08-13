import { TRADING_DAYS } from "@/lib/portfolio/config";

/**
 * Statistics used across the Risk Center.
 *
 * Convention: every function takes SIMPLE returns (not log returns) unless the
 * name says otherwise, and every series is ordered oldest -> newest.
 */

export const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/** Sample standard deviation (n-1). Returns 0 for degenerate input. */
export function stdev(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  const ss = xs.reduce((a, x) => a + (x - m) ** 2, 0);
  return Math.sqrt(ss / (n - 1));
}

export const annualiseVol = (dailyVol: number): number => dailyVol * Math.sqrt(TRADING_DAYS);

/** Geometric annualisation of a mean daily return. */
export const annualiseReturn = (dailyMean: number): number =>
  (1 + dailyMean) ** TRADING_DAYS - 1;

export function toReturns(prices: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    if (prev > 0 && Number.isFinite(prev) && Number.isFinite(prices[i])) {
      out.push(prices[i] / prev - 1);
    }
  }
  return out;
}

/** Sample covariance of two equal-length series. */
export function covariance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (n - 1);
}

export function correlation(a: number[], b: number[]): number {
  const sa = stdev(a);
  const sb = stdev(b);
  if (sa === 0 || sb === 0) return 0;
  const r = covariance(a, b) / (sa * sb);
  return Math.max(-1, Math.min(1, r));
}

/** Full covariance matrix. `series[i]` is asset i's return series. */
export function covarianceMatrix(series: number[][]): number[][] {
  const n = series.length;
  const m: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const c = covariance(series[i], series[j]);
      m[i][j] = c;
      m[j][i] = c;
    }
  }
  return m;
}

export function correlationMatrix(series: number[][]): number[][] {
  const n = series.length;
  const m: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    m[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const c = correlation(series[i], series[j]);
      m[i][j] = c;
      m[j][i] = c;
    }
  }
  return m;
}

/**
 * Portfolio volatility from the covariance matrix: sqrt(wᵀ Σ w).
 *
 * This is deliberately NOT sum(w_i * vol_i) — that naive version ignores
 * correlation and materially overstates risk for a diversified book.
 */
export function portfolioVolatility(weights: number[], cov: number[][]): number {
  const n = weights.length;
  let v = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) v += weights[i] * weights[j] * (cov[i]?.[j] ?? 0);
  }
  return Math.sqrt(Math.max(0, v));
}

/** The naive weighted-average vol, kept only to show the diversification gap. */
export function weightedAverageVolatility(weights: number[], vols: number[]): number {
  return weights.reduce((s, w, i) => s + w * (vols[i] ?? 0), 0);
}

/**
 * Euler risk decomposition.
 *   MCR_i = (Σw)_i / σ_p        marginal contribution
 *   RC_i  = w_i · MCR_i         contribution, and Σ RC_i = σ_p exactly
 *   %RC_i = RC_i / σ_p
 *
 * Risk contribution is NOT allocation weight: a 5% position in a high-vol,
 * high-correlation asset can carry far more than 5% of portfolio risk.
 */
export function riskContributions(
  weights: number[],
  cov: number[][],
): { rc: number[]; pctRc: number[]; sigma: number } {
  const n = weights.length;
  const sigma = portfolioVolatility(weights, cov);
  if (sigma === 0) {
    return { rc: new Array(n).fill(0), pctRc: new Array(n).fill(0), sigma: 0 };
  }
  const rc: number[] = [];
  const pctRc: number[] = [];
  for (let i = 0; i < n; i++) {
    let sw = 0;
    for (let j = 0; j < n; j++) sw += (cov[i]?.[j] ?? 0) * weights[j];
    const contribution = (weights[i] * sw) / sigma;
    rc.push(contribution);
    pctRc.push(contribution / sigma);
  }
  return { rc, pctRc, sigma };
}

/** Linear-interpolated quantile of a sample. `p` in [0,1]. */
export function quantile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

/**
 * Historical VaR as a POSITIVE loss magnitude.
 * `confidence` 0.95 -> the 5th percentile of the return distribution.
 */
export function historicalVaR(returns: number[], confidence = 0.95): number {
  if (returns.length < 20) return 0;
  return Math.max(0, -quantile(returns, 1 - confidence));
}

/** Mean loss conditional on breaching VaR (CVaR), as a positive magnitude. */
export function expectedShortfall(returns: number[], confidence = 0.95): number {
  if (returns.length < 20) return 0;
  const cutoff = quantile(returns, 1 - confidence);
  const tail = returns.filter((r) => r <= cutoff);
  if (tail.length === 0) return 0;
  return Math.max(0, -mean(tail));
}

/** sqrt-of-time scaling for a VaR horizon in days. */
export const scaleVaR = (var1d: number, days: number): number => var1d * Math.sqrt(days);

/** Peak-to-trough drawdown of a cumulative wealth series, as a negative number. */
export function maxDrawdown(levels: number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const v of levels) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = v / peak - 1;
      if (dd < worst) worst = dd;
    }
  }
  return worst;
}

/** Turns a return series into a wealth index starting at 1. */
export function cumulative(returns: number[]): number[] {
  const out: number[] = [];
  let lvl = 1;
  for (const r of returns) {
    lvl *= 1 + r;
    out.push(lvl);
  }
  return out;
}

/** OLS beta of an asset against a benchmark. */
export function beta(asset: number[], benchmark: number[]): number | null {
  const n = Math.min(asset.length, benchmark.length);
  if (n < 20) return null;
  const varB = covariance(benchmark.slice(0, n), benchmark.slice(0, n));
  if (varB === 0) return null;
  return covariance(asset.slice(0, n), benchmark.slice(0, n)) / varB;
}

export function sharpe(annualReturn: number, annualVol: number, riskFree: number): number {
  if (annualVol === 0) return 0;
  return (annualReturn - riskFree) / annualVol;
}

/** Portfolio return series from constituent returns held at fixed weights. */
export function portfolioReturns(weights: number[], series: number[][]): number[] {
  if (series.length === 0) return [];
  const len = Math.min(...series.map((s) => s.length));
  const out: number[] = [];
  for (let t = 0; t < len; t++) {
    let r = 0;
    for (let i = 0; i < series.length; i++) r += weights[i] * series[i][t];
    out.push(r);
  }
  return out;
}

/**
 * Aligns multiple date-indexed price series onto their common dates.
 * Prevents a short/patchy series from silently corrupting the covariance.
 */
export function alignSeries(
  named: { key: string; points: { date: string; close: number }[] }[],
): { dates: string[]; keys: string[]; prices: number[][] } {
  const usable = named.filter((s) => s.points.length > 1);
  if (usable.length === 0) return { dates: [], keys: [], prices: [] };

  let common = new Set<string>(usable[0].points.map((p) => p.date));
  for (const s of usable.slice(1)) {
    const d = new Set<string>(s.points.map((p) => p.date));
    const next = new Set<string>();
    for (const date of common) if (d.has(date)) next.add(date);
    common = next;
  }
  const dates = [...common].sort();
  const prices = usable.map((s) => {
    const byDate = new Map(s.points.map((p) => [p.date, p.close]));
    return dates.map((d) => byDate.get(d) as number);
  });
  return { dates, keys: usable.map((s) => s.key), prices };
}

/** Rolling correlation of two series over the last `window` observations. */
export function rollingCorrelation(a: number[], b: number[], window: number): number {
  const n = Math.min(a.length, b.length);
  const w = Math.min(window, n);
  if (w < 5) return 0;
  return correlation(a.slice(n - w), b.slice(n - w));
}

/** Simple moving average of the last `period` values. */
export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  return mean(values.slice(values.length - period));
}
