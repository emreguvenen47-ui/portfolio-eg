"use client";

import { useEffect, useRef } from "react";

/**
 * OFFICIAL TRADINGVIEW EMBED — the free Advanced Real-Time Chart widget.
 *
 * This IS TradingView (their UI, their drawing tools, their indicators),
 * embedded per their published external-embedding contract. The licensed
 * "Advanced Charts" library is not part of this project; the widget is the
 * legitimate way to get the real TradingView experience. Trade-offs stated
 * honestly: drawings made INSIDE the widget live in TradingView's world (not
 * our per-user store), and EG levels cannot be drawn onto it — that is what
 * the EG chart mode is for. The two modes sit behind one toggle.
 */
export function TvChart({ symbol, height = 560 }: { symbol: string; height?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = "";
    const container = document.createElement("div");
    container.className = "tradingview-widget-container";
    container.style.height = "100%";
    const inner = document.createElement("div");
    inner.className = "tradingview-widget-container__widget";
    inner.style.height = "100%";
    container.appendChild(inner);
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    // BIST symbols map to TradingView's BIST: prefix; US resolves bare.
    const tv = symbol.endsWith(".IS") ? `BIST:${symbol.slice(0, -3)}` : symbol;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tv,
      interval: "D",
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "tr",
      withdateranges: true,
      allow_symbol_change: false,
      details: false,
      hide_side_toolbar: false, // TradingView's own drawing toolbar
      studies: ["STD;RSI"],
      support_host: "https://www.tradingview.com",
    });
    container.appendChild(script);
    el.appendChild(container);
    return () => {
      el.innerHTML = "";
    };
  }, [symbol]);

  return <div ref={ref} style={{ height }} className="w-full" />;
}
