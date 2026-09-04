"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import {
  POINTS_NEEDED,
  TOOL_LABELS,
  hitTest,
  renderDrawing,
  type CoordFns,
  type Drawing,
  type DrawingType,
} from "./drawing-engine";
import {
  bollingerSeries,
  emaSeries,
  macdSeries,
  obvSeries,
  rsiSeries,
  smaSeries,
  stochasticSeries,
  atrSeries,
  vwapSeries,
} from "@/lib/engines/indicators";
import type { TechnicalReport, ReportLevel } from "@/lib/engines/technical-report";

/**
 * TECHNICAL WORKSTATION — the charting terminal.
 *
 * Chart engine: TradingView's official open-source `lightweight-charts` v5
 * (candles/line/area, volume, zoom/pan/crosshair, log scale, panes). The
 * licensed TradingView "Advanced Charts" package is NOT part of this project,
 * so drawings and Fibonacci are implemented on a declarative overlay engine
 * (`drawing-engine.ts`) — stored as time/price, persisted per user+ticker+tf.
 *
 * Two layers, independent: MY DRAWINGS (user, persisted via /api/chart/
 * drawings) and EG ANALYSIS (deterministic engine overlays from /api/
 * technical/analyze). All indicator math comes from lib/engines/indicators —
 * the same functions the analyze report uses.
 */

interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

const RANGES = ["1D", "5D", "1M", "3M", "6M", "1Y", "3Y", "5Y", "MAX"] as const;
type RangeKey = (typeof RANGES)[number];
type ChartType = "candles" | "line" | "area";

const PANE_INDICATORS = [
  { id: "rsi", label: "RSI" },
  { id: "macd", label: "MACD" },
  { id: "stoch", label: "Stochastic" },
  { id: "atr", label: "ATR" },
  { id: "obv", label: "OBV" },
] as const;
type PaneId = (typeof PANE_INDICATORS)[number]["id"];

interface MaOverlay {
  kind: "sma" | "ema";
  period: number;
}

const EG_GROUPS = [
  ["SUPPORT", "Supports", "#34d399"],
  ["RESISTANCE", "Resistances", "#f87171"],
  ["ENTRY", "Entry zones", "#22d3ee"],
  ["STOP", "Stops", "#fbbf24"],
  ["TARGET", "Targets", "#4ade80"],
  ["MA", "Moving averages", "#a78bfa"],
  ["FIB", "Fibonacci", "#f59e0b"],
] as const;

const uid = () => Math.random().toString(36).slice(2, 10);

const toChartTime = (t: string): Time =>
  (t.length <= 10 ? t : (Math.floor(Date.parse(t) / 1000) as unknown)) as Time;

function timeToStr(t: Time): string {
  if (typeof t === "string") return t;
  if (typeof t === "number") return new Date(t * 1000).toISOString();
  const bd = t as { year: number; month: number; day: number };
  return `${bd.year}-${String(bd.month).padStart(2, "0")}-${String(bd.day).padStart(2, "0")}`;
}

export function Workstation({
  symbol,
  compact = false,
}: {
  symbol: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | ISeriesApi<"Area"> | null>(null);
  const priceLinesRef = useRef<Array<{ line: unknown; remove: () => void }>>([]);

  const [range, setRange] = useState<RangeKey>(compact ? "1Y" : "1Y");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [chartType, setChartType] = useState<ChartType>("candles");
  const [logScale, setLogScale] = useState(false);
  const [mas, setMas] = useState<MaOverlay[]>([{ kind: "sma", period: 50 }, { kind: "sma", period: 200 }]);
  const [showBB, setShowBB] = useState(false);
  const [showVwap, setShowVwap] = useState(false);
  const [panes, setPanes] = useState<PaneId[]>([]);
  const [rsiPeriod, setRsiPeriod] = useState(14);

  // Drawings (MY DRAWINGS layer)
  const [tool, setTool] = useState<DrawingType | "select" | "none">("none");
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [pendingPoints, setPendingPoints] = useState<Array<{ time: string; price: number }>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hideMine, setHideMine] = useState(false);
  const undoStack = useRef<Drawing[][]>([]);
  const redoStack = useRef<Drawing[][]>([]);
  const dragRef = useRef<{ id: string; handle: number | null; lastX: number; lastY: number } | null>(null);
  const loadedRef = useRef(false);

  // EG ANALYSIS layer
  const [egOn, setEgOn] = useState<Record<string, boolean>>({ SUPPORT: false, RESISTANCE: false, ENTRY: false, STOP: false, TARGET: false, MA: false, FIB: false });
  const [report, setReport] = useState<TechnicalReport | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeTf, setAnalyzeTf] = useState<"DAILY" | "WEEKLY">("DAILY");
  const [egFib, setEgFib] = useState<{ high: { time: string; price: number }; low: { time: string; price: number } } | null>(null);

  // NL command
  const [nlText, setNlText] = useState("");
  const [nlLog, setNlLog] = useState<Array<{ q: string; a: string }>>([]);
  const [nlBusy, setNlBusy] = useState(false);

  // Paper trade
  const [ptOpen, setPtOpen] = useState(false);
  const [ptQty, setPtQty] = useState("10");
  const [ptMsg, setPtMsg] = useState<string | null>(null);

  const tfKey = range === "1D" || range === "5D" ? "INTRADAY" : "DAILY";

  // ------------------------------------------------------------ data loading
  useEffect(() => {
    let alive = true;
    setLoadErr(null);
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=${range}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (!j.candles?.length) setLoadErr(j.error ?? "No price data.");
        setCandles(j.candles ?? []);
      })
      .catch(() => alive && setLoadErr("Failed to load price history."));
    return () => {
      alive = false;
    };
  }, [symbol, range]);

  // ---------------------------------------------------- drawings persistence
  useEffect(() => {
    loadedRef.current = false;
    fetch(`/api/chart/drawings?symbol=${encodeURIComponent(symbol)}&tf=${tfKey}`)
      .then((r) => r.json())
      .then((j) => {
        setDrawings((j.drawings ?? []) as Drawing[]);
        loadedRef.current = true;
      })
      .catch(() => {
        loadedRef.current = true;
      });
  }, [symbol, tfKey]);

  useEffect(() => {
    if (!loadedRef.current) return;
    const t = setTimeout(() => {
      void fetch("/api/chart/drawings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol, tf: tfKey, drawings }),
      }).catch(() => null);
    }, 700);
    return () => clearTimeout(t);
  }, [drawings, symbol, tfKey]);

  const commit = useCallback((next: Drawing[]) => {
    undoStack.current.push(drawingsRef.current);
    if (undoStack.current.length > 60) undoStack.current.shift();
    redoStack.current = [];
    setDrawings(next);
  }, []);
  const drawingsRef = useRef<Drawing[]>([]);
  drawingsRef.current = drawings;

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (prev) {
      redoStack.current.push(drawingsRef.current);
      setDrawings(prev);
    }
  }, []);
  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (next) {
      undoStack.current.push(drawingsRef.current);
      setDrawings(next);
    }
  }, []);

  // ------------------------------------------------------------- chart build
  const paneList = useMemo(() => ["volume", ...panes] as string[], [panes]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || candles.length === 0) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9ca3af",
        fontSize: 10,
        panes: { separatorColor: "#1f2937", enableResize: true },
      },
      grid: { vertLines: { color: "rgba(148,163,184,0.07)" }, horzLines: { color: "rgba(148,163,184,0.07)" } },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { borderColor: "#1f2937", timeVisible: tfKey === "INTRADAY", rightOffset: 4 },
      rightPriceScale: { borderColor: "#1f2937", mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal },
      autoSize: true,
    });
    chartRef.current = chart;

    const times = candles.map((c) => toChartTime(c.date));

    // Main price series
    let main: ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | ISeriesApi<"Area">;
    if (chartType === "candles") {
      main = chart.addSeries(CandlestickSeries, {
        upColor: "#22c55e",
        downColor: "#ef4444",
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
        borderVisible: false,
      });
      main.setData(candles.map((c, i) => ({ time: times[i]!, open: c.open, high: c.high, low: c.low, close: c.close })));
    } else if (chartType === "line") {
      main = chart.addSeries(LineSeries, { color: "#22d3ee", lineWidth: 2 });
      main.setData(candles.map((c, i) => ({ time: times[i]!, value: c.close })));
    } else {
      main = chart.addSeries(AreaSeries, {
        lineColor: "#22d3ee",
        topColor: "rgba(34,211,238,0.25)",
        bottomColor: "rgba(34,211,238,0)",
      });
      main.setData(candles.map((c, i) => ({ time: times[i]!, value: c.close })));
    }
    mainSeriesRef.current = main;

    // MA / EMA overlays
    const MA_COLORS = ["#f59e0b", "#a78bfa", "#38bdf8", "#f472b6", "#84cc16"];
    mas.forEach((m, i) => {
      const series = chart.addSeries(LineSeries, {
        color: MA_COLORS[i % MA_COLORS.length],
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        title: `${m.kind.toUpperCase()}${m.period}`,
      });
      const src = m.kind === "sma" ? smaSeries(candles as never, m.period) : emaSeries(candles as never, m.period);
      series.setData(
        src.flatMap((p, idx) => (p.value === null ? [] : [{ time: times[idx]!, value: p.value }])),
      );
    });

    if (showBB) {
      const bb = bollingerSeries(candles as never, 20, 2);
      for (const key of ["upper", "middle", "lower"] as const) {
        const s = chart.addSeries(LineSeries, {
          color: key === "middle" ? "rgba(148,163,184,0.7)" : "rgba(148,163,184,0.45)",
          lineWidth: 1,
          lineStyle: key === "middle" ? LineStyle.Solid : LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          title: key === "middle" ? "BB(20,2)" : "",
        });
        s.setData(bb.flatMap((p, idx) => (p[key] === null ? [] : [{ time: times[idx]!, value: p[key]! }])));
      }
    }
    if (showVwap) {
      const vw = vwapSeries(candles as never);
      const s = chart.addSeries(LineSeries, {
        color: "#fb923c",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        priceLineVisible: false,
        lastValueVisible: false,
        title: "VWAP",
      });
      s.setData(vw.flatMap((p, idx) => (p.value === null ? [] : [{ time: times[idx]!, value: p.value }])));
    }

    // Volume pane (index 1)
    const vol = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false },
      1,
    );
    vol.setData(
      candles.map((c, i) => ({
        time: times[i]!,
        value: c.volume ?? 0,
        color: c.close >= c.open ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)",
      })),
    );

    // Extra indicator panes
    let paneIdx = 2;
    for (const id of panes) {
      if (id === "rsi") {
        const s = chart.addSeries(LineSeries, { color: "#a78bfa", lineWidth: 1, title: `RSI(${rsiPeriod})` }, paneIdx);
        const src = rsiSeries(candles as never, rsiPeriod);
        s.setData(src.flatMap((p, idx) => (p.value === null ? [] : [{ time: times[idx]!, value: p.value }])));
        s.createPriceLine({ price: 70, color: "rgba(248,113,113,0.5)", lineWidth: 1, lineStyle: LineStyle.Dashed, title: "70" });
        s.createPriceLine({ price: 30, color: "rgba(52,211,153,0.5)", lineWidth: 1, lineStyle: LineStyle.Dashed, title: "30" });
      } else if (id === "macd") {
        const src = macdSeries(candles as never);
        const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, paneIdx);
        hist.setData(
          src.flatMap((p, idx) =>
            p.histogram === null
              ? []
              : [{ time: times[idx]!, value: p.histogram, color: p.histogram >= 0 ? "rgba(34,197,94,0.6)" : "rgba(239,68,68,0.6)" }],
          ),
        );
        const ml = chart.addSeries(LineSeries, { color: "#38bdf8", lineWidth: 1, title: "MACD" }, paneIdx);
        ml.setData(src.flatMap((p, idx) => (p.macd === null ? [] : [{ time: times[idx]!, value: p.macd }])));
        const sl = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1, title: "signal" }, paneIdx);
        sl.setData(src.flatMap((p, idx) => (p.signal === null ? [] : [{ time: times[idx]!, value: p.signal }])));
      } else if (id === "stoch") {
        const src = stochasticSeries(candles as never);
        const k = chart.addSeries(LineSeries, { color: "#38bdf8", lineWidth: 1, title: "%K" }, paneIdx);
        k.setData(src.flatMap((p, idx) => (p.k === null ? [] : [{ time: times[idx]!, value: p.k }])));
        const dd = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1, title: "%D" }, paneIdx);
        dd.setData(src.flatMap((p, idx) => (p.d === null ? [] : [{ time: times[idx]!, value: p.d }])));
      } else if (id === "atr") {
        const s = chart.addSeries(LineSeries, { color: "#f472b6", lineWidth: 1, title: "ATR(14)" }, paneIdx);
        const src = atrSeries(candles as never, 14);
        s.setData(src.flatMap((p, idx) => (p.value === null ? [] : [{ time: times[idx]!, value: p.value }])));
      } else if (id === "obv") {
        const s = chart.addSeries(LineSeries, { color: "#84cc16", lineWidth: 1, title: "OBV" }, paneIdx);
        const src = obvSeries(candles as never);
        s.setData(src.flatMap((p, idx) => (p.value === null ? [] : [{ time: times[idx]!, value: p.value }])));
      }
      paneIdx++;
    }

    // Pane sizing: main pane gets the bulk.
    try {
      const allPanes = chart.panes();
      if (allPanes.length > 1) {
        allPanes[0]!.setStretchFactor(3);
        for (let i = 1; i < allPanes.length; i++) allPanes[i]!.setStretchFactor(1);
      }
    } catch {
      /* pane API differences are cosmetic only */
    }

    chart.timeScale().fitContent();

    // EG price lines rebuilt by their own effect
    priceLinesRef.current = [];
    rebuildEgLines();

    const redraw = () => drawOverlay();
    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    chart.subscribeCrosshairMove(redraw);
    const ro = new ResizeObserver(() => {
      syncCanvas();
      drawOverlay();
    });
    ro.observe(el);
    syncCanvas();
    drawOverlay();

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      mainSeriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, chartType, logScale, mas, showBB, showVwap, panes, rsiPeriod, tfKey]);

  // ------------------------------------------------------------ EG overlays
  const rebuildEgLines = useCallback(() => {
    const main = mainSeriesRef.current;
    if (!main) return;
    for (const pl of priceLinesRef.current) pl.remove();
    priceLinesRef.current = [];
    if (!report) return;
    const colorFor: Record<string, string> = Object.fromEntries(EG_GROUPS.map(([k, , c]) => [k, c]));
    for (const lvl of report.overlays as ReportLevel[]) {
      if (!egOn[lvl.kind]) continue;
      const line = main.createPriceLine({
        price: lvl.price,
        color: colorFor[lvl.kind] ?? "#f59e0b",
        lineWidth: 1,
        lineStyle: lvl.kind === "FIB" || lvl.kind === "MA" ? LineStyle.Dotted : LineStyle.Dashed,
        title: `EG ${lvl.label}`,
      });
      priceLinesRef.current.push({ line, remove: () => main.removePriceLine(line) });
    }
  }, [report, egOn]);

  useEffect(() => {
    rebuildEgLines();
    drawOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, egOn]);

  // --------------------------------------------------------- overlay canvas
  const coordFns = useCallback((): CoordFns | null => {
    const chart = chartRef.current;
    const main = mainSeriesRef.current;
    const el = containerRef.current;
    if (!chart || !main || !el) return null;
    const ts = chart.timeScale();
    return {
      x: (t) => {
        const c = ts.timeToCoordinate(toChartTime(t));
        return c === null ? null : c;
      },
      y: (p) => {
        const c = main.priceToCoordinate(p);
        return c === null ? null : c;
      },
      priceAt: (y) => {
        const p = main.coordinateToPrice(y);
        return p === null ? null : p;
      },
      timeAt: (x) => {
        const t = ts.coordinateToTime(x);
        return t === null ? null : timeToStr(t);
      },
      width: el.clientWidth,
      height: el.clientHeight,
    };
  }, []);

  const syncCanvas = useCallback(() => {
    const el = containerRef.current;
    const cv = canvasRef.current;
    if (!el || !cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = el.clientWidth * dpr;
    cv.height = el.clientHeight * dpr;
    cv.style.width = `${el.clientWidth}px`;
    cv.style.height = `${el.clientHeight}px`;
    cv.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  const drawOverlay = useCallback(() => {
    const cv = canvasRef.current;
    const fns = coordFns();
    if (!cv || !fns) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, fns.width, fns.height);
    if (!hideMine) {
      for (const d of drawingsRef.current) {
        renderDrawing(ctx, d, fns, { selected: d.id === selectedId });
      }
    }
    // in-progress preview
    if (pendingRef.current.length && toolRef.current !== "none" && toolRef.current !== "select") {
      renderDrawing(
        ctx,
        { id: "__pending", type: toolRef.current as DrawingType, points: pendingRef.current, color: "#22d3ee" },
        fns,
        {},
      );
    }
    // EG fib (from NL command) — engine layer styling
    if (egFibRef.current) {
      renderDrawing(
        ctx,
        {
          id: "__egfib",
          type: "fib-retracement",
          points: [
            { time: egFibRef.current.low.time, price: egFibRef.current.low.price },
            { time: egFibRef.current.high.time, price: egFibRef.current.high.price },
          ],
          color: "#f59e0b",
        },
        fns,
        { eg: true },
      );
    }
  }, [coordFns, hideMine, selectedId]);

  const pendingRef = useRef(pendingPoints);
  pendingRef.current = pendingPoints;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const egFibRef = useRef(egFib);
  egFibRef.current = egFib;

  useEffect(() => {
    drawOverlay();
  }, [drawings, pendingPoints, selectedId, hideMine, egFib, drawOverlay]);

  // ------------------------------------------------------- pointer handling
  const onCanvasDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const fns = coordFns();
    if (!fns) return;
    const t = toolRef.current;

    if (t === "select") {
      const hit = hitTest(drawingsRef.current, fns, pos);
      setSelectedId(hit?.id ?? null);
      if (hit) {
        dragRef.current = { id: hit.id, handle: hit.handle, lastX: pos.x, lastY: pos.y };
        undoStack.current.push(drawingsRef.current.map((d) => ({ ...d, points: d.points.map((p) => ({ ...p })) })));
        redoStack.current = [];
      }
      return;
    }
    if (t === "none") return;

    const time = fns.timeAt(pos.x) ?? candles[candles.length - 1]?.date ?? null;
    const price = fns.priceAt(pos.y);
    if (time === null || price === null) return;
    const nextPts = [...pendingRef.current, { time, price }];
    const needed = POINTS_NEEDED[t as DrawingType];
    if (nextPts.length >= needed) {
      let text: string | undefined;
      if (t === "text") {
        text = window.prompt("Text:") ?? undefined;
        if (!text) {
          setPendingPoints([]);
          return;
        }
      }
      commit([...drawingsRef.current, { id: uid(), type: t as DrawingType, points: nextPts, text }]);
      setPendingPoints([]);
      setTool("select");
    } else {
      setPendingPoints(nextPts);
    }
  };

  const onCanvasMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      drawOverlay();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const fns = coordFns();
    if (!fns) return;
    const dxTime = fns.timeAt(pos.x);
    const dyPrice = fns.priceAt(pos.y);
    setDrawings((ds) =>
      ds.map((d) => {
        if (d.id !== drag.id) return d;
        if (drag.handle !== null) {
          // move one endpoint
          const pts = d.points.map((p, i) =>
            i === drag.handle && dxTime !== null && dyPrice !== null ? { time: dxTime, price: dyPrice } : p,
          );
          return { ...d, points: pts };
        }
        // move whole drawing by price delta (and time via x delta best-effort)
        const prevPrice = fns.priceAt(drag.lastY);
        const priceDelta = dyPrice !== null && prevPrice !== null ? dyPrice - prevPrice : 0;
        const pts = d.points.map((p) => ({ time: p.time, price: p.price + priceDelta }));
        return { ...d, points: pts };
      }),
    );
    dragRef.current = { ...drag, lastX: pos.x, lastY: pos.y };
  };

  const onCanvasUp = () => {
    dragRef.current = null;
  };

  // ----------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "Escape") {
        if (toolRef.current !== "none" || pendingRef.current.length) {
          setTool("none");
          setPendingPoints([]);
          setSelectedId(null);
        } else if (!compact) {
          router.back();
        }
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        commit(drawingsRef.current.filter((d) => d.id !== selectedId));
        setSelectedId(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault();
        redo();
      }
      if (e.key.toLowerCase() === "v") setTool("select");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, commit, undo, redo, compact, router]);

  // ----------------------------------------------------------------- ANALYZE
  const runAnalyze = async () => {
    setAnalyzing(true);
    try {
      const r = await fetch(`/api/technical/analyze?symbol=${encodeURIComponent(symbol)}&tf=${analyzeTf}`);
      const j = await r.json();
      if (j.report) {
        setReport(j.report as TechnicalReport);
        setEgOn({ SUPPORT: true, RESISTANCE: true, ENTRY: true, STOP: true, TARGET: true, MA: false, FIB: false });
      }
    } finally {
      setAnalyzing(false);
    }
  };

  // ---------------------------------------------------------------- NL cmd
  const runNl = async () => {
    const q = nlText.trim();
    if (!q || nlBusy) return;
    setNlBusy(true);
    setNlText("");
    try {
      const r = await fetch("/api/technical/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol, text: q, tf: analyzeTf }),
      });
      const j = await r.json();
      setNlLog((l) => [...l.slice(-6), { q, a: j.answer ?? j.error ?? "?" }]);
      // Apply client ops deterministically.
      for (const op of j.clientOps ?? []) {
        if (op.op === "add-ma") setMas((m) => (m.some((x) => x.period === op.period) ? m : [...m, { kind: "sma", period: op.period as number }]));
        if (op.op === "add-indicator") {
          const id = op.id as PaneId | "bb";
          if (id === "bb") setShowBB(true);
          else setPanes((p) => (p.includes(id) ? p : [...p, id]));
        }
        if (op.op === "add-fib") setEgFib({ high: op.high as never, low: op.low as never });
      }
      // Overlays returned → ensure a report exists to hold them, or draw via price lines through report state.
      if ((j.overlays ?? []).length && !report) {
        // fetch full report so toggles work consistently
        void runAnalyze();
      }
      if ((j.overlays ?? []).length) {
        const kinds = new Set((j.overlays as ReportLevel[]).map((o) => o.kind));
        setEgOn((prev) => {
          const next = { ...prev };
          for (const k of kinds) next[k] = true;
          return next;
        });
      }
    } finally {
      setNlBusy(false);
    }
  };

  // ------------------------------------------------------------ paper trade
  const openPaper = async () => {
    const lastClose = candles[candles.length - 1]?.close;
    if (!lastClose) return;
    setPtMsg(null);
    const r = await fetch("/api/virtual/paper", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        symbol,
        side: "BUY",
        quantity: Number(ptQty) || 1,
        entry: lastClose,
        stop: report?.stops.find((s) => s.kind === "STANDARD")?.price ?? null,
        target1: report?.targets.find((t) => t.kind === "T1")?.price ?? null,
        target2: report?.targets.find((t) => t.kind === "T2")?.price ?? null,
        note: "Opened from Technical Workstation",
      }),
    });
    const j = await r.json();
    setPtMsg(
      j.ok
        ? `Paper trade booked (id ${String(j.tradeId).slice(0, 8)}…) with an immutable entry snapshot — see Paper Trading.`
        : `Failed: ${j.error ?? "unknown"}`,
    );
  };

  // ------------------------------------------------------------------ UI
  const ohlc = candles[candles.length - 1] ?? null;
  const canvasInteractive = tool !== "none";

  const btn = (on: boolean) =>
    `rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wide transition-colors ${
      on ? "border-cyan-500/70 bg-cyan-500/10 text-cyan-300" : "border-[var(--line)] text-[var(--ink-3)] hover:text-[var(--ink-1,inherit)]"
    }`;

  return (
    <div className={`flex ${compact ? "h-[560px]" : "h-[calc(100vh-8px)]"} w-full flex-col gap-1 text-[11px]`}>
      {/* ------------------------------------------------------------ top bar */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-[var(--line)] px-2 py-1">
        <span className="text-[12px] font-bold tracking-tight text-cyan-300">{symbol}</span>
        <span className="tabular-nums text-[var(--ink-2)]">
          {ohlc ? `O ${ohlc.open.toFixed(2)} H ${ohlc.high.toFixed(2)} L ${ohlc.low.toFixed(2)} C ${ohlc.close.toFixed(2)}` : "…"}
        </span>
        <span className="mx-1 h-4 w-px bg-[var(--line)]" />
        {RANGES.map((r) => (
          <button key={r} type="button" onClick={() => setRange(r)} className={btn(range === r)}>
            {r}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-[var(--line)]" />
        {(["candles", "line", "area"] as ChartType[]).map((t) => (
          <button key={t} type="button" onClick={() => setChartType(t)} className={btn(chartType === t)}>
            {t}
          </button>
        ))}
        <button type="button" onClick={() => setLogScale((v) => !v)} className={btn(logScale)}>
          LOG
        </button>
        <span className="mx-1 h-4 w-px bg-[var(--line)]" />
        {/* indicator toggles */}
        {[20, 50, 100, 200].map((p) => (
          <button
            key={p}
            type="button"
            onClick={() =>
              setMas((m) => (m.some((x) => x.period === p && x.kind === "sma") ? m.filter((x) => !(x.period === p && x.kind === "sma")) : [...m, { kind: "sma", period: p }]))
            }
            className={btn(mas.some((x) => x.period === p && x.kind === "sma"))}
          >
            MA{p}
          </button>
        ))}
        <button type="button" onClick={() => setShowBB((v) => !v)} className={btn(showBB)}>
          BB
        </button>
        <button type="button" onClick={() => setShowVwap((v) => !v)} className={btn(showVwap)}>
          VWAP
        </button>
        {PANE_INDICATORS.map((pi) => (
          <button
            key={pi.id}
            type="button"
            onClick={() => setPanes((p) => (p.includes(pi.id) ? p.filter((x) => x !== pi.id) : [...p, pi.id]))}
            className={btn(panes.includes(pi.id))}
          >
            {pi.label}
          </button>
        ))}
        {panes.includes("rsi") && (
          <input
            type="number"
            value={rsiPeriod}
            onChange={(e) => setRsiPeriod(Math.max(2, Math.min(100, Number(e.target.value) || 14)))}
            className="w-12 rounded border border-[var(--line)] bg-transparent px-1 py-0.5 text-[9.5px] tabular-nums"
            title="RSI period"
          />
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {compact ? (
            <Link
              href={`/chart/${encodeURIComponent(symbol)}`}
              className="rounded border border-cyan-500/70 bg-cyan-500/10 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-cyan-300"
            >
              ⛶ Full Screen
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded border border-[var(--line)] px-2 py-0.5 text-[9.5px] uppercase tracking-wider text-[var(--ink-3)]"
              title="ESC"
            >
              ✕ Exit (ESC)
            </button>
          )}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 gap-1">
        {/* ---------------------------------------------------- left toolbar */}
        {!compact && (
          <div className="flex w-9 flex-col items-center gap-0.5 overflow-y-auto rounded border border-[var(--line)] py-1">
            {TOOL_LABELS.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.hint}
                onClick={() => {
                  setTool(t.id as DrawingType | "select");
                  setPendingPoints([]);
                }}
                className={`h-7 w-7 rounded text-[12px] leading-none ${
                  tool === t.id ? "bg-cyan-500/20 text-cyan-300" : "text-[var(--ink-3)] hover:bg-[var(--line)]"
                }`}
              >
                {t.label}
              </button>
            ))}
            <div className="my-1 h-px w-6 bg-[var(--line)]" />
            <button type="button" title="Pan / zoom mode (ESC)" onClick={() => { setTool("none"); setPendingPoints([]); }} className={`h-7 w-7 rounded text-[12px] ${tool === "none" ? "bg-cyan-500/20 text-cyan-300" : "text-[var(--ink-3)] hover:bg-[var(--line)]"}`}>
              ✥
            </button>
            <button type="button" title="Undo (Ctrl+Z)" onClick={undo} className="h-7 w-7 rounded text-[12px] text-[var(--ink-3)] hover:bg-[var(--line)]">↶</button>
            <button type="button" title="Redo (Ctrl+Y)" onClick={redo} className="h-7 w-7 rounded text-[12px] text-[var(--ink-3)] hover:bg-[var(--line)]">↷</button>
            <button type="button" title="Hide/show my drawings" onClick={() => setHideMine((v) => !v)} className={`h-7 w-7 rounded text-[12px] ${hideMine ? "text-rose-400" : "text-[var(--ink-3)]"} hover:bg-[var(--line)]`}>
              👁
            </button>
            <button
              type="button"
              title="Clear all drawings"
              onClick={() => {
                if (drawingsRef.current.length && window.confirm("Delete ALL drawings for this chart?")) commit([]);
              }}
              className="h-7 w-7 rounded text-[12px] text-[var(--ink-3)] hover:bg-[var(--line)]"
            >
              🗑
            </button>
          </div>
        )}

        {/* --------------------------------------------------------- chart */}
        <div className="relative min-w-0 flex-1 overflow-hidden rounded border border-[var(--line)] bg-black/20">
          {loadErr ? (
            <div className="flex h-full items-center justify-center text-[var(--ink-3)]">{loadErr}</div>
          ) : (
            <>
              <div ref={containerRef} className="absolute inset-0" />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 z-10"
                style={{ pointerEvents: canvasInteractive ? "auto" : "none", cursor: tool === "select" ? "default" : "crosshair" }}
                onPointerDown={onCanvasDown}
                onPointerMove={onCanvasMove}
                onPointerUp={onCanvasUp}
              />
              {tool !== "none" && (
                <div className="absolute left-2 top-2 z-20 rounded bg-black/70 px-2 py-0.5 text-[9.5px] text-cyan-300">
                  {tool === "select"
                    ? selectedId
                      ? "Selected — drag to move, handles to reshape, Delete to remove"
                      : "Select mode — click a drawing"
                    : `${tool} — click ${POINTS_NEEDED[tool as DrawingType] - pendingPoints.length} more point(s) · ESC cancels`}
                </div>
              )}
            </>
          )}
        </div>

        {/* ----------------------------------------------------- right panel */}
        {!compact && (
          <div className="flex w-[300px] shrink-0 flex-col gap-1 overflow-y-auto rounded border border-[var(--line)] p-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">EG Technical Analysis</span>
              <select
                value={analyzeTf}
                onChange={(e) => setAnalyzeTf(e.target.value as "DAILY" | "WEEKLY")}
                className="ml-auto rounded border border-[var(--line)] bg-transparent px-1 py-0.5 text-[9px]"
              >
                <option value="DAILY">DAILY</option>
                <option value="WEEKLY">WEEKLY</option>
              </select>
              <button
                type="button"
                onClick={runAnalyze}
                disabled={analyzing}
                className="rounded border border-amber-500/70 bg-amber-500/10 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-amber-400 disabled:opacity-50"
              >
                {analyzing ? "…" : "Analyze"}
              </button>
            </div>

            {/* EG layer toggles */}
            <div className="flex flex-wrap gap-1">
              {EG_GROUPS.map(([k, label, color]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setEgOn((s) => ({ ...s, [k]: !s[k] }))}
                  className="rounded border px-1.5 py-0.5 text-[8.5px] uppercase tracking-wide"
                  style={{
                    borderColor: egOn[k] ? color : "var(--line)",
                    color: egOn[k] ? color : "var(--ink-3)",
                    background: egOn[k] ? `${color}18` : "transparent",
                  }}
                  disabled={!report}
                  title={report ? label : "Run Analyze first"}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* NL command */}
            <div className="rounded border border-[var(--line)] p-1.5">
              <div className="text-[8.5px] uppercase tracking-wider text-[var(--ink-3)]">Command — natural language → deterministic functions</div>
              <div className="mt-1 flex gap-1">
                <input
                  value={nlText}
                  onChange={(e) => setNlText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void runNl()}
                  placeholder="“ana destekleri göster”, “fibonacci çiz”, “MA200 ekle”…"
                  className="min-w-0 flex-1 rounded border border-[var(--line)] bg-transparent px-1.5 py-1 text-[10px] outline-none focus:border-cyan-500/60"
                />
                <button type="button" onClick={() => void runNl()} disabled={nlBusy} className="rounded border border-cyan-500/60 px-2 text-[9.5px] text-cyan-300 disabled:opacity-50">
                  ↵
                </button>
              </div>
              {nlLog.length > 0 && (
                <div className="mt-1 flex flex-col gap-1">
                  {nlLog.slice(-3).map((l, i) => (
                    <div key={i} className="text-[9.5px] leading-snug">
                      <span className="text-cyan-300">» {l.q}</span>
                      <div className="text-[var(--ink-2)]">{l.a}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Paper trade */}
            <div className="rounded border border-[var(--line)] p-1.5">
              <div className="flex items-center gap-1">
                <span className="text-[8.5px] uppercase tracking-wider text-[var(--ink-3)]">Paper trade</span>
                <input
                  type="number"
                  value={ptQty}
                  onChange={(e) => setPtQty(e.target.value)}
                  className="ml-auto w-14 rounded border border-[var(--line)] bg-transparent px-1 py-0.5 text-[10px] tabular-nums"
                  title="quantity"
                />
                <button
                  type="button"
                  onClick={() => void openPaper()}
                  className="rounded border border-emerald-500/70 bg-emerald-500/10 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-emerald-400"
                >
                  Open Paper Trade
                </button>
              </div>
              {ptMsg && <div className="mt-1 text-[9.5px] leading-snug text-[var(--ink-2)]">{ptMsg}</div>}
            </div>

            {/* Report */}
            {report ? (
              <ReportPanel report={report} />
            ) : (
              <div className="rounded border border-dashed border-[var(--line)] p-2 text-[10px] leading-snug text-[var(--ink-3)]">
                Run <span className="text-amber-400">ANALYZE</span> for the full deterministic report: market structure,
                S/R, moving averages, momentum, volume, volatility, patterns, Fibonacci, entry/stop/target maps,
                scenarios and the final verdict — all drawn on the chart via the toggles above.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- report panel

function Sec({ title, lines }: { title: string; lines: string[] }) {
  if (!lines.length) return null;
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-amber-400/90">{title}</div>
      <ul className="mt-0.5 list-disc pl-3.5 text-[10px] leading-snug text-[var(--ink-2)]">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

function ReportPanel({ report: r }: { report: TechnicalReport }) {
  return (
    <div data-testid="eg-report" className="flex flex-col gap-2 rounded border border-[var(--line)] p-2">
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span className="text-[11px] font-bold">{r.verdict.signal.replaceAll("_", " ")}</span>
        <span className="text-[9.5px] text-[var(--ink-3)]">
          {r.verdict.setup !== "NONE" ? r.verdict.setup.replaceAll("_", " ") : "no setup"} · score {r.verdict.score ?? "N/A"} ·{" "}
          {r.verdict.confidence} · {r.verdict.freshness} · {r.timeframe} · as of {r.asOf}
        </span>
      </div>
      <p className="text-[10px] leading-snug text-[var(--ink-1,inherit)]">{r.verdict.interpretation}</p>

      <Sec title="Market structure" lines={r.structure.lines} />
      <Sec title="Support / resistance" lines={r.levels.lines} />
      <div>
        <div className="text-[9px] font-semibold uppercase tracking-wider text-amber-400/90">Moving averages</div>
        <table className="mt-0.5 w-full text-[9.5px] tabular-nums">
          <tbody>
            {r.movingAverages.map((m) => (
              <tr key={m.label}>
                <td className="text-[var(--ink-3)]">{m.label}</td>
                <td>{m.value ?? "N/A"}</td>
                <td className={m.distancePct !== null && m.distancePct >= 0 ? "text-emerald-400" : "text-rose-400"}>
                  {m.distancePct !== null ? `${m.distancePct >= 0 ? "+" : ""}${m.distancePct}%` : "—"}
                </td>
                <td className="text-[var(--ink-3)]">{m.slope ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.maNotes.map((n) => (
          <div key={n} className="text-[9.5px] text-[var(--ink-3)]">{n}</div>
        ))}
      </div>
      <Sec title="Momentum" lines={r.momentum.lines} />
      <Sec title="Volume" lines={r.volume.lines} />
      <Sec title="Volatility" lines={r.volatility.lines} />
      <Sec title="Patterns (evidence-based)" lines={r.patterns.length ? r.patterns : ["No deterministic pattern evidence right now — none invented."]} />
      {r.fibonacci.available && (
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-wider text-amber-400/90">Fibonacci</div>
          <div className="text-[9.5px] leading-snug text-[var(--ink-2)]">
            Swing {r.fibonacci.swingLow?.price} ({r.fibonacci.swingLow?.date}) → {r.fibonacci.swingHigh?.price} ({r.fibonacci.swingHigh?.date}), {r.fibonacci.direction}.{" "}
            {r.fibonacci.retracements.map((x) => `${(x.ratio * 100).toFixed(1)}%: ${x.price}`).join(" · ")}. Ext:{" "}
            {r.fibonacci.extensions.map((x) => `${x.ratio}: ${x.price}`).join(" · ")}. {r.fibonacci.nearest ?? ""}
          </div>
        </div>
      )}
      <div>
        <div className="text-[9px] font-semibold uppercase tracking-wider text-amber-400/90">Entry map</div>
        <ul className="mt-0.5 text-[9.5px] tabular-nums text-[var(--ink-2)]">
          {r.entries.map((e) => (
            <li key={e.kind}>
              <span className="inline-block w-20 text-[var(--ink-3)]">{e.kind}</span>
              {e.price ?? "N/A"} <span className="text-[var(--ink-3)]">— {e.note}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="text-[9px] font-semibold uppercase tracking-wider text-amber-400/90">Stop map</div>
        <ul className="mt-0.5 text-[9.5px] tabular-nums text-[var(--ink-2)]">
          {r.stops.length ? (
            r.stops.map((s) => (
              <li key={s.kind}>
                <span className="inline-block w-20 text-[var(--ink-3)]">{s.kind}</span>
                {s.price} · risk {s.riskPct}% · {s.atrDistance} ATR <span className="text-[var(--ink-3)]">— {s.reason}</span>
              </li>
            ))
          ) : (
            <li className="text-[var(--ink-3)]">No published stop — no actionable structure.</li>
          )}
        </ul>
      </div>
      <div>
        <div className="text-[9px] font-semibold uppercase tracking-wider text-amber-400/90">Targets</div>
        <ul className="mt-0.5 text-[9.5px] tabular-nums text-[var(--ink-2)]">
          {r.targets.filter((t) => t.price !== null).map((t) => (
            <li key={t.kind}>
              <span className="inline-block w-20 text-[var(--ink-3)]">{t.kind}</span>
              {t.price} <span className="text-[var(--ink-3)]">— {t.note}</span>
            </li>
          ))}
        </ul>
      </div>
      {r.riskReward.length > 0 && (
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-wider text-amber-400/90">Risk / reward</div>
          <ul className="mt-0.5 text-[9.5px] tabular-nums text-[var(--ink-2)]">
            {r.riskReward.map((c) => (
              <li key={c.combo}>
                {c.combo}: risk {c.risk}, reward {c.reward} → <span className={c.rr >= 2 ? "text-emerald-400" : ""}>R:R {c.rr}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <div className="text-[9px] font-semibold uppercase tracking-wider text-amber-400/90">Scenarios</div>
        {r.scenarios.map((s) => (
          <div key={s.case} className="mt-0.5 text-[9.5px] leading-snug">
            <span className={s.case === "BULL" ? "text-emerald-400" : s.case === "BEAR" ? "text-rose-400" : "text-[var(--ink-2)]"}>
              {s.case}
            </span>{" "}
            <span className="text-[var(--ink-2)]">
              trigger: {s.trigger} → target: {s.target} · invalidation: {s.invalidation}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
