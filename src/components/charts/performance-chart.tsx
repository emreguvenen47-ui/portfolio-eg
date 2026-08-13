"use client";

import { useMemo, useState } from "react";
import { LineChartPanel, type ChartSeries } from "./line-chart";
import { cn } from "@/lib/utils";
import type { Point } from "@/lib/portfolio/analytics";

const RANGES = ["1D", "1M", "3M", "YTD", "1Y", "MAX"] as const;
type Range = (typeof RANGES)[number];

const RANGE_BARS: Record<Range, number> = {
  "1D": 2,
  "1M": 22,
  "3M": 64,
  YTD: 0,
  "1Y": 253,
  MAX: Number.MAX_SAFE_INTEGER,
};

function slice(points: Point[], range: Range): Point[] {
  if (points.length === 0) return points;
  if (range === "YTD") {
    const start = `${new Date().getUTCFullYear()}-01-01`;
    const i = points.findIndex((p) => p.date >= start);
    return i <= 0 ? points : points.slice(i - 1);
  }
  return points.slice(Math.max(0, points.length - RANGE_BARS[range]));
}

/** Rebases to 100 at the first point so all series are visually comparable. */
function rebase(points: Point[]): { date: string; value: number }[] {
  const base = points[0]?.close;
  if (!base) return [];
  return points.map((p) => ({ date: p.date, value: (p.close / base) * 100 }));
}

export interface BenchmarkOption {
  key: string;
  label: string;
  color: string;
  points: Point[];
}

export function PerformanceChart({
  portfolio,
  benchmarks,
  height = 280,
  fxHistories,
}: {
  portfolio: Point[];
  benchmarks: BenchmarkOption[];
  height?: number;
  fxHistories?: { usdTry?: Point[]; eurUsd?: Point[] };
}) {
  const [range, setRange] = useState<Range>("YTD");
  const [active, setActive] = useState<string[]>([]);
  const [currency, setCurrency] = useState<"USD" | "EUR" | "TRY">("USD");
  const [cumulative, setCumulative] = useState(false);

  const usdTryByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of fxHistories?.usdTry ?? []) m.set(p.date, p.close);
    return m;
  }, [fxHistories]);

  const eurUsdByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of fxHistories?.eurUsd ?? []) m.set(p.date, p.close);
    return m;
  }, [fxHistories]);

  function convertPoints(points: Point[], to: "USD" | "EUR" | "TRY") {
    if (to === "USD") return points.map((p) => ({ date: p.date, close: p.close }));
    if (to === "EUR") {
      return points.map((p) => {
        const eurRate = eurUsdByDate.get(p.date) ?? eurUsdByDate.get(Array.from(eurUsdByDate.keys()).pop() ?? "") ?? 1;
        return { date: p.date, close: p.close / (eurRate || 1) };
      });
    }
    // TRY
    return points.map((p) => {
      const usdTry = usdTryByDate.get(p.date) ?? usdTryByDate.get(Array.from(usdTryByDate.keys()).pop() ?? "") ?? 0;
      return { date: p.date, close: p.close * (usdTry || 0) };
    });
  }

  const series = useMemo<ChartSeries[]>(() => {
    const convPort = convertPoints(portfolio, currency);
    const out: ChartSeries[] = [
      {
        name: "Portfolio",
        color: "#ffa028",
        type: "area",
        data: cumulative ? slice(convPort, range).map((p) => ({ date: p.date, value: p.close })) : rebase(slice(convPort, range)),
      },
    ];
    for (const b of benchmarks) {
      if (!active.includes(b.key)) continue;
      const convB = convertPoints(b.points, currency);
      out.push({
        name: b.label,
        color: b.color,
        type: "line",
        data: cumulative ? slice(convB, range).map((p) => ({ date: p.date, value: p.close })) : rebase(slice(convB, range)),
      });
    }
    return out;
  }, [portfolio, benchmarks, range, active, currency, cumulative]);

  const stat = useMemo(() => {
    const s = series[0]?.data ?? [];
    if (s.length < 2) return null;
    const ret = s[s.length - 1].value / s[0].value - 1;
    return ret;
  }, [series]);

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <div className="flex gap-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn(
                "rounded-sm px-1.5 py-0.5 text-[10px] font-semibold tracking-wide transition-colors",
                range === r
                  ? "bg-[rgba(255,160,40,0.15)] text-[var(--amber)]"
                  : "text-[var(--ink-3)] hover:text-[var(--ink)]",
              )}
            >
              {r}
            </button>
          ))}
        </div>

        <div className="mx-1 h-3 w-px bg-[var(--line)]" />

        <span className="text-[9.5px] uppercase tracking-wider text-[var(--ink-3)]">
          Benchmarks
        </span>
        {benchmarks.map((b) => {
          const on = active.includes(b.key);
          return (
            <button
              key={b.key}
              type="button"
              onClick={() =>
                setActive((prev) =>
                  prev.includes(b.key) ? prev.filter((x) => x !== b.key) : [...prev, b.key],
                )
              }
              className={cn(
                "flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] transition-colors",
                on
                  ? "border-[var(--line)] bg-[var(--panel-2)] text-[var(--ink)]"
                  : "border-transparent text-[var(--ink-3)] hover:text-[var(--ink-2)]",
              )}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: on ? b.color : "#3a424e" }}
              />
              {b.label}
            </button>
          );
        })}

        {stat !== null && (
          <span
            className={cn(
              "ml-auto tnum text-[11px] font-semibold",
              stat >= 0 ? "text-[var(--up)]" : "text-[var(--down)]",
            )}
          >
            {stat >= 0 ? "+" : ""}
            {(stat * 100).toFixed(2)}% <span className="text-[var(--ink-3)]">({range})</span>
          </span>
        )}
        <div className="ml-3 flex items-center gap-2">
          <select className="text-xs" value={currency} onChange={(e) => setCurrency(e.target.value as any)}>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="TRY">TRY</option>
          </select>
          <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={cumulative} onChange={(e) => setCumulative(e.target.checked)} /> Cumulative</label>
        </div>
      </div>

      {series[0]?.data.length ? (
        <LineChartPanel series={series} height={height} priceFormat="percent" />
      ) : (
        <div className="flex items-center justify-center p-8 text-[11px] text-[var(--ink-3)]">
          Not enough history to plot this range.
        </div>
      )}
      <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
        All series rebased to 100 at the start of the selected range. Portfolio is a
        target-weight index in USD.
      </div>
    </div>
  );
}
