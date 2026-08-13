"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { correlationColor } from "@/lib/format";

export interface CorrWindow {
  key: string;
  codes: string[];
  matrix: number[][];
  observations: number;
}

export function CorrelationMatrix({ windows }: { windows: CorrWindow[] }) {
  const [active, setActive] = useState(windows.find((w) => w.matrix.length)?.key ?? windows[0]?.key);
  const win = windows.find((w) => w.key === active) ?? windows[0];

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <span className="text-[9.5px] uppercase tracking-wider text-[var(--ink-3)]">Window</span>
        {windows.map((w) => (
          <button
            key={w.key}
            type="button"
            disabled={w.matrix.length === 0}
            onClick={() => setActive(w.key)}
            className={cn(
              "rounded-sm px-1.5 py-0.5 text-[10px] font-semibold",
              w.matrix.length === 0
                ? "cursor-not-allowed text-[var(--ink-3)]/40"
                : active === w.key
                  ? "bg-[rgba(255,160,40,0.15)] text-[var(--amber)]"
                  : "text-[var(--ink-3)] hover:text-[var(--ink)]",
            )}
            title={w.matrix.length === 0 ? "Not enough history for this window" : undefined}
          >
            {w.key}
          </button>
        ))}
        {win && (
          <span className="ml-auto text-[10px] text-[var(--ink-3)]">
            {win.observations} observations
          </span>
        )}
      </div>

      {!win || win.matrix.length === 0 ? (
        <div className="p-6 text-center text-[11px] text-[var(--ink-3)]">
          Not enough overlapping history to compute this window.
        </div>
      ) : (
        <div className="overflow-x-auto p-3">
          <table className="border-collapse text-[10px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-[var(--panel)] p-1" />
                {win.codes.map((c) => (
                  <th
                    key={c}
                    className="p-1 text-center font-semibold text-[var(--ink-3)]"
                    style={{ minWidth: 44 }}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {win.codes.map((rowCode, i) => (
                <tr key={rowCode}>
                  <th className="sticky left-0 z-10 bg-[var(--panel)] px-2 py-1 text-right font-semibold text-[var(--ink-2)]">
                    {rowCode}
                  </th>
                  {win.codes.map((colCode, j) => {
                    const v = win.matrix[i]?.[j] ?? 0;
                    const self = i === j;
                    return (
                      <td
                        key={colCode}
                        className="tnum border border-[var(--panel)] p-1 text-center"
                        style={{
                          background: self ? "var(--panel-2)" : correlationColor(v),
                          color: self ? "var(--ink-3)" : "var(--ink)",
                        }}
                        title={`${rowCode} vs ${colCode}: ${v.toFixed(3)}`}
                      >
                        {self ? "—" : v.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
        <span className="flex items-center gap-1">
          <span className="h-2 w-6" style={{ background: correlationColor(-1) }} />−1
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-6" style={{ background: correlationColor(0) }} />0
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-6" style={{ background: correlationColor(1) }} />+1
        </span>
        <span className="ml-2">
          Pearson correlation of daily USD returns. Red = moves together (less
          diversification); blue = moves opposite (hedge).
        </span>
      </div>
    </div>
  );
}
