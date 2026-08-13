"use client";

import { useEffect, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

export interface ChartSeries {
  name: string;
  color: string;
  data: { date: string; value: number }[];
  type?: "area" | "line";
}

/**
 * Accepts both a bare `yyyy-mm-dd` and a full ISO timestamp, so the same chart
 * renders daily candles and intraday 5-minute bars without a second code path.
 */
const toTime = (iso: string): UTCTimestamp =>
  (Date.parse(iso.length <= 10 ? `${iso}T00:00:00Z` : iso) / 1000) as UTCTimestamp;

/**
 * TradingView Lightweight Charts wrapper (v5 `addSeries` API).
 * Rebasing to 100 is the caller's job; this component just draws.
 */
export function LineChartPanel({
  series,
  height = 260,
  priceFormat = "percent",
}: {
  series: ChartSeries[];
  height?: number;
  priceFormat?: "percent" | "price";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const chart = createChart(el, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b949e",
        fontSize: 10,
        fontFamily:
          "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(29,34,42,0.6)" },
        horzLines: { color: "rgba(29,34,42,0.6)" },
      },
      rightPriceScale: { borderColor: "#1d222a", scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderColor: "#1d222a", rightOffset: 2, fixLeftEdge: true },
      crosshair: {
        mode: 1,
        vertLine: { color: "#ffa028", width: 1, style: 2, labelBackgroundColor: "#b8721c" },
        horzLine: { color: "#ffa028", width: 1, style: 2, labelBackgroundColor: "#b8721c" },
      },
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
    });
    chartRef.current = chart;

    const handles: ISeriesApi<"Area" | "Line">[] = [];
    series.forEach((s, i) => {
      const data: LineData<Time>[] = s.data
        .filter((d) => Number.isFinite(d.value))
        .map((d) => ({ time: toTime(d.date), value: d.value }));
      if (data.length === 0) return;

      const common = {
        color: s.color,
        lineWidth: 2 as const,
        priceLineVisible: false,
        lastValueVisible: true,
        title: s.name,
        priceFormat:
          priceFormat === "percent"
            ? ({ type: "custom" as const, formatter: (v: number) => `${v.toFixed(1)}` })
            : ({ type: "price" as const, precision: 2, minMove: 0.01 }),
      };

      if ((s.type ?? (i === 0 ? "area" : "line")) === "area") {
        const h = chart.addSeries(AreaSeries, {
          ...common,
          lineColor: s.color,
          topColor: `${s.color}33`,
          bottomColor: `${s.color}03`,
        });
        h.setData(data);
        handles.push(h);
      } else {
        const h = chart.addSeries(LineSeries, { ...common, lineWidth: 1 });
        h.setData(data);
        handles.push(h);
      }
    });

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth });
      chart.timeScale().fitContent();
    });
    ro.observe(el);
    chart.applyOptions({ width: el.clientWidth });

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [series, height, priceFormat]);

  return <div ref={ref} className="w-full" style={{ height }} />;
}
