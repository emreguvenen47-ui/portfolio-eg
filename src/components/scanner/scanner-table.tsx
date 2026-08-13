"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import usePoll from "@/lib/use-poll";
import { Chip, Empty } from "@/components/shell/ui";
import { cn } from "@/lib/utils";
import { SCAN_FILTERS } from "@/lib/portfolio/scanner";
import type { ScanRow } from "@/lib/portfolio/scanner";

const VERDICT_TONE = {
  ATTRACTIVE: "pos",
  NEUTRAL: "neutral",
  EXTENDED: "neg",
} as const;

const COMPONENT_ORDER = [
  "fromHigh",
  "trend",
  "rsi",
  "momentum",
  "volatility",
  "quality",
  "valuation",
  "analyst",
] as const;

const COMPONENT_LABEL: Record<string, string> = {
  fromHigh: "52w",
  trend: "Trend",
  rsi: "RSI",
  momentum: "Mom",
  volatility: "Vol",
  quality: "Qual",
  valuation: "Val",
  analyst: "Anlst",
};

/**
 * Scanner results. Polls the shared endpoint on a slow clock — the sweep is
 * cached server-side for fifteen minutes because none of these inputs move
 * meaningfully faster than that.
 */
export function ScannerTable() {
  const [filter, setFilter] = useState<string>("All");
  const { data, loading } = usePoll<{ rows: ScanRow[] }>("/api/scanner", 15 * 60_000);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    return filter === "All" ? all : all.filter((r) => r.tags.includes(filter));
  }, [data, filter]);

  if (loading) {
    return <div className="p-3 text-[11px] text-[var(--ink-3)]">Scanning…</div>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--line)] px-2 py-1.5">
        {SCAN_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-sm border px-2 py-0.5 text-[10px] transition-colors",
              filter === f
                ? "border-[var(--amber)] bg-[rgba(255,160,40,0.12)] text-[var(--amber)]"
                : "border-[var(--line)] text-[var(--ink-3)] hover:border-[var(--ink-3)]",
            )}
          >
            {f}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-[var(--ink-3)]">{rows.length} candidates</span>
      </div>

      {rows.length === 0 ? (
        <Empty>No candidate matches this filter.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Symbol</th>
                <th>Score</th>
                <th className="tl">Verdict</th>
                {COMPONENT_ORDER.map((k) => (
                  <th key={k}>{COMPONENT_LABEL[k]}</th>
                ))}
                <th className="tl">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol}>
                  <td className="tl font-semibold">
                    <Link
                      href={`/ticker/${encodeURIComponent(r.symbol)}`}
                      className="hover:text-[var(--amber)]"
                    >
                      {r.symbol}
                    </Link>
                  </td>
                  <td className="tabular-nums font-semibold">{r.score ?? "N/A"}</td>
                  <td className="tl">
                    <Chip tone={VERDICT_TONE[r.verdict]}>{r.verdict}</Chip>
                  </td>
                  {COMPONENT_ORDER.map((k) => {
                    const c = r.components.find((x) => x.key === k);
                    return (
                      <td
                        key={k}
                        className={cn(
                          "tabular-nums",
                          !c
                            ? "text-[var(--ink-3)]"
                            : c.score >= 65
                              ? "text-emerald-400"
                              : c.score <= 35
                                ? "text-rose-400"
                                : "",
                        )}
                        title={c ? `${c.label}: ${c.detail}` : "no data"}
                      >
                        {c ? c.score : "—"}
                      </td>
                    );
                  })}
                  <td className="tl text-[10px] text-[var(--ink-3)]">{r.coverage}/8</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-[var(--line)] px-3 py-2 text-[9.5px] leading-snug text-[var(--ink-3)]">
        Each component is a clamped 0–100 grade: discount to the 52-week high (a deep drawdown
        past −45% scores down, not up), 50/200DMA trend penalised for being stretched, RSI scored
        toward mid-range, 6-month momentum, realised volatility inverted, Financial Quality Score,
        P/E inverted, and analyst mix where covered. The score is the mean of the components that
        had data — hover any cell for its reading, and check Coverage before trusting a rank.
        ATTRACTIVE ≥ 62, EXTENDED ≤ 42.
      </div>
    </div>
  );
}
