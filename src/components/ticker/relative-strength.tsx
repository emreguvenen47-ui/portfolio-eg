"use client";

import { useEffect, useState } from "react";
import { Chip, Empty, Panel } from "@/components/shell/ui";
import { fmtPctPoints, signClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RS_BENCHMARKS } from "@/lib/portfolio/relative-strength";
import type { RelativeStrength } from "@/lib/portfolio/relative-strength";

/**
 * Relative strength panel. Client-side so switching benchmark is instant and
 * does not re-render the whole ticker page; the series it compares are already
 * cached in the provider layer.
 */
export function RelativeStrengthPanel({ symbol }: { symbol: string }) {
  const [benchmark, setBenchmark] = useState<string>("SPY");
  const [data, setData] = useState<RelativeStrength | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/relative-strength?symbol=${encodeURIComponent(symbol)}&benchmark=${benchmark}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setData(j.rs ?? null);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, benchmark]);

  const verdict = data?.verdict ?? "N/A";

  return (
    <Panel
      title="Relative Strength"
      subtitle={`${symbol} vs benchmark, same window on both legs`}
      actions={
        <Chip
          tone={
            verdict === "OUTPERFORMING"
              ? "pos"
              : verdict === "UNDERPERFORMING"
                ? "neg"
                : "neutral"
          }
        >
          {verdict}
        </Chip>
      }
      bodyClassName="p-0"
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--line)] px-2 py-1.5">
        {RS_BENCHMARKS.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => setBenchmark(b.key)}
            disabled={b.key === symbol}
            className={cn(
              "rounded-sm border px-2 py-0.5 text-[10px] transition-colors disabled:opacity-30",
              benchmark === b.key
                ? "border-[var(--amber)] bg-[rgba(255,160,40,0.12)] text-[var(--amber)]"
                : "border-[var(--line)] text-[var(--ink-3)] hover:border-[var(--ink-3)]",
            )}
          >
            vs {b.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-3 text-[10px] text-[var(--ink-3)]">Loading…</div>
      ) : !data || data.rows.every((r) => r.relative === null) ? (
        <Empty>Not enough overlapping price history to compare.</Empty>
      ) : (
        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">Window</th>
              <th>{symbol}</th>
              <th>{data.benchmark}</th>
              <th>Relative</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.label}>
                <td className="tl">{r.label}</td>
                <td className={cn("tabular-nums", signClass(r.asset))}>
                  {r.asset === null ? "N/A" : fmtPctPoints(r.asset)}
                </td>
                <td className={cn("tabular-nums", signClass(r.benchmark))}>
                  {r.benchmark === null ? "N/A" : fmtPctPoints(r.benchmark)}
                </td>
                <td className={cn("tabular-nums font-semibold", signClass(r.relative))}>
                  {r.relative === null
                    ? "N/A"
                    : `${r.relative >= 0 ? "+" : ""}${r.relative.toFixed(2)}pp`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
