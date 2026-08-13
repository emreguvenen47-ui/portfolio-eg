"use client";

import { useState } from "react";
import { Scanner } from "@/components/markets/scanner";
import { StocksScanner } from "@/components/markets/stocks-scanner";

export function ScannerShell() {
  const [tab, setTab] = useState<"etf" | "stocks">("etf");
  return (
    <div>
      <div className="flex gap-2 mb-2">
        <button
          type="button"
          onClick={() => setTab("etf")}
          className={`chip ${tab === "etf" ? "border-[var(--amber)] bg-[rgba(255,160,40,0.08)]" : ""}`}
        >
          ETFs
        </button>
        <button
          type="button"
          onClick={() => setTab("stocks")}
          className={`chip ${tab === "stocks" ? "border-[var(--amber)] bg-[rgba(255,160,40,0.08)]" : ""}`}
        >
          Stocks
        </button>
      </div>
      <div>{tab === "etf" ? <Scanner /> : <StocksScanner />}</div>
    </div>
  );
}
