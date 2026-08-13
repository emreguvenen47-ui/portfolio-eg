"use client";

import { useEffect, useMemo, useState } from "react";
import { LineChartPanel, type ChartSeries } from "./line-chart";
import { cn } from "@/lib/utils";
import { Empty } from "@/components/shell/ui";

const RANGES = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "MAX"] as const;
type Range = (typeof RANGES)[number];

/** Trading days to keep for each daily range. Intraday ranges fetch their own. */
const BARS: Partial<Record<Range, number>> = {
  "1M": 22,
  "3M": 64,
  "6M": 128,
  "1Y": 253,
  "3Y": 756,
  "5Y": 1260,
};

interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

function movingAverage(points: Candle[], period: number) {
  if (points.length < period) return [];
  const out: { date: string; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += points[i].close;
    if (i >= period) sum -= points[i - period].close;
    if (i >= period - 1) out.push({ date: points[i].date, value: sum / period });
  }
  return out;
}

/**
 * Historical price chart for any ticker.
 *
 * Each range is fetched on demand from `/api/history` and kept in a local map,
 * so flipping back to a range already viewed is instant and costs no request.
 * The provider layer caches underneath as well — daily series for hours,
 * intraday for two minutes — so a multi-year series is never re-pulled on the
 * quote refresh clock.
 */
export function TickerChart({ symbol }: { symbol: string }) {
  const [range, setRange] = useState<Range>("1Y");
  const [cache, setCache] = useState<Record<string, Candle[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ma, setMa] = useState({ d20: false, d50: true, d200: true });

  useEffect(() => {
    // "MAX" and the long ranges all come from the same deepest pull, but the
    // API decides how many bars each needs; key the cache by range.
    if (cache[range]) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=${range}`)
      .then((r) => r.json())
      .then((j: { candles?: Candle[]; error?: string }) => {
        if (cancelled) return;
        if (j.error || !j.candles?.length) {
          setError(j.error ?? "HISTORICAL DATA UNAVAILABLE");
          setCache((c) => ({ ...c, [range]: [] }));
          return;
        }
        setCache((c) => ({ ...c, [range]: j.candles! }));
      })
      .catch(() => {
        if (!cancelled) setError("HISTORICAL DATA UNAVAILABLE");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, range, cache]);

  const candles = cache[range] ?? [];
  const intraday = range === "1D" || range === "5D";

  const series = useMemo<ChartSeries[]>(() => {
    if (candles.length === 0) return [];

    // Moving averages need the full series, then get clipped to the window —
    // otherwise a 200DMA would be blank on every short range.
    const ma20 = movingAverage(candles, 20);
    const ma50 = movingAverage(candles, 50);
    const ma200 = movingAverage(candles, 200);

    const from =
      range === "YTD"
        ? `${new Date().getUTCFullYear()}-01-01`
        : range === "MAX" || intraday
          ? candles[0].date
          : (candles[Math.max(0, candles.length - (BARS[range] ?? 253))]?.date ??
            candles[0].date);

    const clip = <T extends { date: string }>(xs: T[]) => xs.filter((x) => x.date >= from);

    const out: ChartSeries[] = [
      {
        name: "Price",
        color: "#ffa028",
        type: "area",
        data: clip(candles.map((c) => ({ date: c.date, value: c.close }))),
      },
    ];
    // Moving averages are meaningless on an intraday series of 5-minute bars.
    if (!intraday) {
      if (ma.d20 && ma20.length)
        out.push({ name: "20DMA", color: "#4f9df7", type: "line", data: clip(ma20) });
      if (ma.d50 && ma50.length)
        out.push({ name: "50DMA", color: "#26c281", type: "line", data: clip(ma50) });
      if (ma.d200 && ma200.length)
        out.push({ name: "200DMA", color: "#b98cff", type: "line", data: clip(ma200) });
    }
    return out;
  }, [candles, range, ma, intraday]);

  const hasVolume = candles.some((c) => (c.volume ?? 0) > 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--line)] px-2 py-1.5">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={cn(
              "rounded-sm border px-1.5 py-0.5 text-[10px] transition-colors",
              range === r
                ? "border-[var(--amber)] bg-[rgba(255,160,40,0.12)] text-[var(--amber)]"
                : "border-[var(--line)] text-[var(--ink-3)] hover:border-[var(--ink-3)] hover:text-[var(--ink-2)]",
            )}
          >
            {r}
          </button>
        ))}

        {!intraday && (
          <div className="ml-2 flex items-center gap-1">
            {(
              [
                ["20DMA", "d20"],
                ["50DMA", "d50"],
                ["200DMA", "d200"],
              ] as const
            ).map(([label, key]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMa((m) => ({ ...m, [key]: !m[key] }))}
                className={cn(
                  "rounded-sm border px-1.5 py-0.5 text-[9.5px] transition-colors",
                  ma[key]
                    ? "border-[var(--ink-3)] text-[var(--ink)]"
                    : "border-[var(--line)] text-[var(--ink-3)]",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <span className="ml-auto text-[10px] text-[var(--ink-3)]">
          {loading ? "loading…" : hasVolume ? "volume available" : ""}
        </span>
      </div>

      {error && candles.length === 0 ? (
        <Empty>
          {intraday
            ? // Only one provider carries intraday bars; daily ranges come from
              // several, so an intraday gap is a source limitation rather than
              // the symbol having no history at all.
              "INTRADAY DATA UNAVAILABLE — no configured provider is serving 5-minute bars right now. Daily ranges (1M and longer) are available."
            : error}
        </Empty>
      ) : series.length === 0 ? (
        <Empty>{loading ? "Loading price history…" : "HISTORICAL DATA UNAVAILABLE"}</Empty>
      ) : (
        <LineChartPanel series={series} height={380} priceFormat="price" />
      )}
    </div>
  );
}
