"use client";

import { useMemo, useState } from "react";
import { LineChartPanel, type ChartSeries } from "./line-chart";
import { cn } from "@/lib/utils";
import type { Point } from "@/lib/portfolio/analytics";

const RANGES = ["1M", "3M", "YTD", "1Y", "MAX"] as const;
type Range = (typeof RANGES)[number];
const BARS: Record<Range, number> = {
  "1M": 22,
  "3M": 64,
  YTD: 0,
  "1Y": 253,
  MAX: Number.MAX_SAFE_INTEGER,
};

function movingAverage(points: Point[], period: number): { date: string; value: number }[] {
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

export function AssetChart({ points }: { points: Point[] }) {
  const [range, setRange] = useState<Range>("1Y");
  const [showMa, setShowMa] = useState(true);

  const series = useMemo<ChartSeries[]>(() => {
    if (points.length === 0) return [];
    // Moving averages are computed on the FULL history, then clipped to the
    // visible window — otherwise a 200DMA would be blank on short ranges.
    const ma20 = movingAverage(points, 20);
    const ma50 = movingAverage(points, 50);
    const ma200 = movingAverage(points, 200);

    const from =
      range === "YTD"
        ? `${new Date().getUTCFullYear()}-01-01`
        : range === "MAX"
          ? points[0].date
          : (points[Math.max(0, points.length - BARS[range])]?.date ?? points[0].date);

    const clip = <T extends { date: string }>(xs: T[]) => xs.filter((x) => x.date >= from);

    const out: ChartSeries[] = [
      {
        name: "Price",
        color: "#ffa028",
        type: "area",
        data: clip(points.map((p) => ({ date: p.date, value: p.close }))),
      },
    ];
    if (showMa) {
      if (ma20.length) out.push({ name: "20DMA", color: "#4f9df7", type: "line", data: clip(ma20) });
      if (ma50.length) out.push({ name: "50DMA", color: "#26c281", type: "line", data: clip(ma50) });
      if (ma200.length)
        out.push({ name: "200DMA", color: "#c07de0", type: "line", data: clip(ma200) });
    }
    return out;
  }, [points, range, showMa]);

  if (points.length === 0) {
    return (
      <div className="p-8 text-center text-[11px] text-[var(--ink-3)]">
        No price history available for this instrument.
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <div className="flex gap-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn(
                "rounded-sm px-1.5 py-0.5 text-[10px] font-semibold",
                range === r
                  ? "bg-[rgba(255,160,40,0.15)] text-[var(--amber)]"
                  : "text-[var(--ink-3)] hover:text-[var(--ink)]",
              )}
            >
              {r}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowMa((v) => !v)}
          className={cn(
            "ml-auto rounded-sm border px-1.5 py-0.5 text-[10px]",
            showMa
              ? "border-[var(--line)] bg-[var(--panel-2)] text-[var(--ink)]"
              : "border-transparent text-[var(--ink-3)]",
          )}
        >
          Moving averages
        </button>
      </div>
      <LineChartPanel series={series} height={300} priceFormat="price" />
    </div>
  );
}
