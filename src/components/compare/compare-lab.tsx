"use client";

import { useState } from "react";
import Link from "next/link";
import { Chip, Note } from "@/components/shell/ui";
import { cn } from "@/lib/utils";
import { COMPARE_GROUPS, type CompareResult } from "@/lib/research/compare";

const PRESETS: { label: string; symbols: string[] }[] = [
  { label: "Mega-cap tech", symbols: ["AAPL", "MSFT", "GOOGL", "META"] },
  { label: "Semis", symbols: ["NVDA", "AVGO", "AMD", "TSM"] },
  { label: "US banks", symbols: ["JPM", "BAC", "GS"] },
  { label: "BIST banks", symbols: ["GARAN", "AKBNK", "YKBNK", "ISCTR"] },
  { label: "BIST large caps", symbols: ["THYAO", "ASELS", "TUPRS", "KCHOL"] },
];

const RANK_CLASS = {
  BEST: "text-emerald-400 font-semibold",
  STRONG: "text-emerald-400/70",
  WEAK: "text-rose-400",
} as const;

export function CompareLab({ initial }: { initial: string[] }) {
  const [input, setInput] = useState(initial.join(", "));
  const [symbols, setSymbols] = useState<string[]>(initial);
  const [data, setData] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(list: string[]) {
    const clean = [...new Set(list.map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 5);
    if (clean.length < 2) {
      setError("Enter between 2 and 5 symbols.");
      return;
    }
    setSymbols(clean);
    setInput(clean.join(", "));
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/compare?symbols=${encodeURIComponent(clean.join(","))}`);
      const json = await res.json();
      if (json.error) setError(json.error);
      else setData(json.result as CompareResult);
    } catch {
      setError("Comparison failed.");
    } finally {
      setLoading(false);
    }
  }

  const cols = data?.symbols ?? symbols;

  return (
    <div className="flex flex-col gap-3">
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Compare</h2>
          <span className="text-[10px] text-[var(--ink-3)]">2–5 symbols · US and BIST</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run(input.split(","))}
            placeholder="AAPL, MSFT, NVDA"
            className="min-w-[220px] flex-1 rounded-sm border border-[var(--line)] bg-[var(--panel-2)] px-2 py-1 text-[12px] outline-none focus:border-[var(--amber)]"
          />
          <button
            type="button"
            onClick={() => run(input.split(","))}
            disabled={loading}
            className="rounded-sm border border-[var(--amber)] bg-[rgba(255,160,40,0.12)] px-3 py-1 text-[11px] text-[var(--amber)] disabled:opacity-50"
          >
            {loading ? "Loading…" : "Compare"}
          </button>
        </div>
        <div className="flex flex-wrap gap-1 border-t border-[var(--line)] px-3 py-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => run(p.symbols)}
              className="rounded-sm border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--ink-3)] hover:border-[var(--ink-3)] hover:text-[var(--ink)]"
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      {error && <Note tone="warn">{error}</Note>}

      {data && (
        <>
          <Note>
            <strong>BEST</strong> and <strong>WEAK</strong> are only awarded when at least three
            columns carry a real value and there is no tie. A metric that is not economically
            meaningful for a company — gross margin or free cash flow for a bank — reads N/A and
            is excluded from ranking rather than counted as a loss.
          </Note>

          <section className="panel" >
            <div className="overflow-x-auto">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th className="tl sticky left-0 z-10 bg-[var(--panel)]">Metric</th>
                    {cols.map((s) => (
                      <th key={s} className="whitespace-nowrap">
                        <Link href={`/ticker/${s}`} className="hover:text-[var(--amber)]">
                          {s}
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_GROUPS.map((group) => {
                    const rows = data.rows.filter((r) => r.group === group);
                    const texts = data.textRows.filter((r) => r.group === group);
                    if (!rows.length && !texts.length) return null;
                    return (
                      <>
                        <tr key={`h-${group}`}>
                          <td
                            className="tl bg-[var(--panel-2)] text-[9.5px] uppercase tracking-wide text-[var(--ink-3)]"
                            colSpan={cols.length + 1}
                          >
                            {group}
                          </td>
                        </tr>
                        {rows.map((r) => (
                          <tr key={r.key}>
                            <td className="tl sticky left-0 z-10 bg-[var(--panel)]">{r.label}</td>
                            {r.cells.map((c, i) => (
                              <td
                                key={i}
                                className={cn(
                                  "tabular-nums",
                                  c.rank ? RANK_CLASS[c.rank] : "",
                                  c.value === null && "text-[var(--ink-3)]",
                                )}
                                title={c.notApplicable}
                              >
                                {c.display}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {texts.map((r) => (
                          <tr key={r.key}>
                            <td className="tl sticky left-0 z-10 bg-[var(--panel)]">{r.label}</td>
                            {r.values.map((v, i) => (
                              <td
                                key={i}
                                className={cn(
                                  "tl text-[10px]",
                                  v === "N/A" && "text-[var(--ink-3)]",
                                )}
                              >
                                {v}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <div className="flex flex-wrap gap-2 text-[10px] text-[var(--ink-3)]">
            <Chip tone="pos">BEST</Chip> best of the field
            <Chip tone="neutral">STRONG</Chip> runner-up, four or more columns only
            <Chip tone="neg">WEAK</Chip> worst of the field
          </div>
        </>
      )}
    </div>
  );
}
