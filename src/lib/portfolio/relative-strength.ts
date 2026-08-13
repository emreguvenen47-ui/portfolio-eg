import type { Candle } from "@/lib/types";

/**
 * Relative performance against a benchmark, per timeframe.
 *
 * Both legs are measured over the SAME window from the SAME bar index, so the
 * comparison cannot be flattered by one series starting a session earlier than
 * the other. A window either series cannot cover reads N/A rather than being
 * silently shortened.
 */

export const RS_BENCHMARKS = [
  { key: "SPY", label: "SPY" },
  { key: "QQQ", label: "QQQ" },
  { key: "XU100", label: "BIST 100" },
] as const;

export type RsBenchmark = (typeof RS_BENCHMARKS)[number]["key"];

const WINDOWS: { label: string; bars: number | "ytd" }[] = [
  { label: "1M", bars: 22 },
  { label: "3M", bars: 64 },
  { label: "6M", bars: 128 },
  { label: "YTD", bars: "ytd" },
  { label: "1Y", bars: 253 },
];

export interface RsRow {
  label: string;
  asset: number | null;
  benchmark: number | null;
  relative: number | null;
}

export interface RelativeStrength {
  benchmark: string;
  rows: RsRow[];
  /** Verdict from the windows that could actually be measured. */
  verdict: "OUTPERFORMING" | "UNDERPERFORMING" | "MIXED" | "N/A";
}

export function returnOver(candles: Candle[], bars: number | "ytd"): number | null {
  if (candles.length < 2) return null;
  const last = candles[candles.length - 1].close;

  if (bars === "ytd") {
    const start = `${new Date().getUTCFullYear()}-01-01`;
    const ref = candles.find((c) => c.date >= start)?.close;
    return ref && ref > 0 ? (last / ref - 1) * 100 : null;
  }

  // Refuse a window the series does not cover — clipping to the first bar
  // would report a five-year return in the "1Y" row.
  if (candles.length <= bars) return null;
  const ref = candles[candles.length - 1 - bars]?.close;
  return ref && ref > 0 ? (last / ref - 1) * 100 : null;
}

export function relativeStrength(
  asset: Candle[],
  benchmark: Candle[],
  benchmarkLabel: string,
): RelativeStrength {
  const rows: RsRow[] = WINDOWS.map((w) => {
    const a = returnOver(asset, w.bars);
    const b = returnOver(benchmark, w.bars);
    return {
      label: w.label,
      asset: a,
      benchmark: b,
      relative: a !== null && b !== null ? a - b : null,
    };
  });

  const measured = rows.map((r) => r.relative).filter((x): x is number => x !== null);
  const up = measured.filter((x) => x > 0).length;

  return {
    benchmark: benchmarkLabel,
    rows,
    verdict:
      measured.length === 0
        ? "N/A"
        : up === measured.length
          ? "OUTPERFORMING"
          : up === 0
            ? "UNDERPERFORMING"
            : "MIXED",
  };
}
