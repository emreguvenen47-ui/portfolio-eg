import type { Point } from "./analytics";

/**
 * Timeframe returns, alpha and drawdown against a benchmark.
 *
 * Both series are windowed to the SAME start date before anything is computed.
 * Comparing a two-week-old portfolio against a benchmark's full history is the
 * classic way to manufacture a flattering (or damning) alpha number that means
 * nothing, so the window is always the overlap.
 */

export const TIMEFRAMES = ["1M", "3M", "YTD", "1Y", "3Y", "SINCE"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const BENCHMARKS = [
  { key: "SPX", label: "S&P 500" },
  { key: "NDX", label: "Nasdaq 100" },
  { key: "XU100", label: "BIST 100" },
] as const;

export interface TimeframeRow {
  timeframe: Timeframe;
  portfolio: number | null;
  benchmark: number | null;
  /** Portfolio minus benchmark, in percentage points. */
  relative: number | null;
}

export interface BenchmarkReport {
  rows: TimeframeRow[];
  maxDrawdown: number;
  benchmarkMaxDrawdown: number;
  /** Overlapping window actually used. */
  from: string | null;
  to: string | null;
}

function startFor(tf: Timeframe, series: Point[]): string {
  if (tf === "SINCE") return series[0]?.date ?? "";
  if (tf === "YTD") return `${new Date().getUTCFullYear()}-01-01`;
  const days = { "1M": 30, "3M": 90, "1Y": 365, "3Y": 1095 }[tf];
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function returnFrom(series: Point[], from: string): number | null {
  const start = series.find((p) => p.date >= from);
  const end = series.at(-1);
  if (!start || !end || start.close <= 0 || start.date === end.date) return null;
  return (end.close / start.close - 1) * 100;
}

function drawdown(series: Point[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const p of series) {
    peak = Math.max(peak, p.close);
    if (peak > 0) worst = Math.min(worst, p.close / peak - 1);
  }
  return worst * 100;
}

export function compareToBenchmark(
  portfolio: Point[],
  benchmark: Point[],
): BenchmarkReport {
  if (portfolio.length < 2) {
    return {
      rows: [],
      maxDrawdown: 0,
      benchmarkMaxDrawdown: 0,
      from: null,
      to: null,
    };
  }

  const from = portfolio[0].date;
  const windowed = benchmark.filter((p) => p.date >= from);

  const rows: TimeframeRow[] = TIMEFRAMES.map((tf) => {
    // A timeframe that starts before the portfolio existed is reported as
    // null on both sides rather than silently truncated to the shorter life.
    const start = startFor(tf, portfolio);
    const usable = tf === "SINCE" || start >= from;
    const p = usable ? returnFrom(portfolio, start) : null;
    const b = usable ? returnFrom(windowed, start) : null;
    return {
      timeframe: tf,
      portfolio: p,
      benchmark: b,
      relative: p !== null && b !== null ? p - b : null,
    };
  });

  return {
    rows,
    maxDrawdown: drawdown(portfolio),
    benchmarkMaxDrawdown: drawdown(windowed),
    from,
    to: portfolio.at(-1)?.date ?? null,
  };
}

/** Rebase a benchmark onto the portfolio's starting value for chart overlay. */
export function rebase(points: Point[], from: string, toValue: number): Point[] {
  const window = points.filter((p) => p.date >= from);
  const base = window[0]?.close;
  if (!base || base <= 0) return [];
  return window.map((p) => ({ date: p.date, close: (p.close / base) * toValue }));
}
