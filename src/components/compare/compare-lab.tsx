"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CompareRow } from "@/app/api/compare/route";

/**
 * COMPARISON LAB — 2–5 companies side by side on the canonical engines:
 * a normalized 1-year performance race, then a metric matrix where the best
 * value in every row is highlighted (direction-aware: low P/E wins, high
 * ROIC wins). Same numbers as the ticker pages, because it IS the same stack.
 */

const COLORS = ["#22d3ee", "#f59e0b", "#34d399", "#a78bfa", "#f472b6"];

const fmt = {
  x: (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}×`),
  pctF: (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`),
  pctP: (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`),
  mcap: (v: number | null) =>
    v === null ? "—" : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : `$${(v / 1e9).toFixed(1)}B`,
  num: (v: number | null, d = 2) => (v === null ? "—" : v.toFixed(d)),
};

interface MetricSpec {
  group: string;
  label: string;
  get: (r: CompareRow) => number | null;
  show: (r: CompareRow) => string;
  best: "high" | "low" | null;
  hint?: string;
}

const METRICS: MetricSpec[] = [
  { group: "SIZE & PRICE", label: "Market cap", get: (r) => r.marketCap, show: (r) => fmt.mcap(r.marketCap), best: null },
  { group: "SIZE & PRICE", label: "1M return", get: (r) => r.perf1M, show: (r) => fmt.pctP(r.perf1M), best: "high" },
  { group: "SIZE & PRICE", label: "6M return", get: (r) => r.perf6M, show: (r) => fmt.pctP(r.perf6M), best: "high" },
  { group: "SIZE & PRICE", label: "1Y return", get: (r) => r.perf1Y, show: (r) => fmt.pctP(r.perf1Y), best: "high" },
  { group: "VALUATION", label: "P/E (TTM)", get: (r) => r.peTtm, show: (r) => fmt.x(r.peTtm), best: "low" },
  { group: "VALUATION", label: "Forward P/E", get: (r) => r.forwardPe, show: (r) => fmt.x(r.forwardPe), best: "low" },
  { group: "VALUATION", label: "P/S", get: (r) => r.priceToSales, show: (r) => fmt.x(r.priceToSales), best: "low" },
  { group: "VALUATION", label: "P/B", get: (r) => r.priceToBook, show: (r) => fmt.x(r.priceToBook), best: "low" },
  { group: "VALUATION", label: "EV/EBITDA", get: (r) => r.evToEbitda, show: (r) => fmt.x(r.evToEbitda), best: "low" },
  { group: "VALUATION", label: "FCF yield", get: (r) => r.fcfYield, show: (r) => fmt.pctF(r.fcfYield), best: "high" },
  { group: "VALUATION", label: "EG model upside", get: (r) => r.upsidePct, show: (r) => (r.upsidePct === null ? (r.valuationConfidence === "INVALID" ? "INVALID" : "—") : fmt.pctP(r.upsidePct)), best: "high", hint: "blended fair value vs price; INVALID = inputs failed the quality gates" },
  { group: "GROWTH", label: "Revenue growth YoY", get: (r) => r.revenueGrowthYoY, show: (r) => fmt.pctF(r.revenueGrowthYoY), best: "high" },
  { group: "GROWTH", label: "Fwd EPS growth", get: (r) => r.epsGrowthFwd, show: (r) => fmt.pctF(r.epsGrowthFwd), best: "high", hint: "street next-FY EPS vs trailing" },
  { group: "PROFITABILITY", label: "Gross margin", get: (r) => r.grossMargin, show: (r) => fmt.pctF(r.grossMargin), best: "high" },
  { group: "PROFITABILITY", label: "Operating margin", get: (r) => r.operatingMargin, show: (r) => fmt.pctF(r.operatingMargin), best: "high" },
  { group: "PROFITABILITY", label: "Net margin", get: (r) => r.netMargin, show: (r) => fmt.pctF(r.netMargin), best: "high" },
  { group: "PROFITABILITY", label: "ROE", get: (r) => r.roe, show: (r) => fmt.pctF(r.roe), best: "high" },
  { group: "PROFITABILITY", label: "ROIC", get: (r) => r.roic, show: (r) => fmt.pctF(r.roic), best: "high" },
  { group: "BALANCE SHEET", label: "Net debt / EBITDA", get: (r) => (r.netDebtToEbitda === null ? null : -r.netDebtToEbitda), show: (r) => fmt.num(r.netDebtToEbitda, 1), best: "high", hint: "lower leverage wins (net cash best)" },
  { group: "BALANCE SHEET", label: "Current ratio", get: (r) => r.currentRatio, show: (r) => fmt.num(r.currentRatio, 2), best: "high" },
  { group: "TECHNICAL", label: "Signal", get: () => null, show: (r) => (r.signal ?? "—").replaceAll("_", " "), best: null },
  { group: "TECHNICAL", label: "Setup", get: () => null, show: (r) => (r.setup ?? "—").replaceAll("_", " "), best: null },
  { group: "TECHNICAL", label: "Technical score", get: (r) => r.technicalScore, show: (r) => (r.technicalScore === null ? "—" : `${r.technicalScore}/100`), best: "high" },
  { group: "TECHNICAL", label: "R:R", get: (r) => r.riskReward, show: (r) => fmt.num(r.riskReward, 1), best: "high" },
  { group: "RISK", label: "Beta vs S&P", get: () => null, show: (r) => fmt.num(r.beta, 2), best: null },
  { group: "RISK", label: "Realized vol", get: (r) => (r.realizedVolPct === null ? null : -r.realizedVolPct), show: (r) => (r.realizedVolPct === null ? "—" : `${r.realizedVolPct}%`), best: "high", hint: "calmer wins" },
  { group: "RISK", label: "Max drawdown (2y)", get: (r) => r.maxDrawdownPct, show: (r) => (r.maxDrawdownPct === null ? "—" : `${r.maxDrawdownPct}%`), best: "high", hint: "shallower wins" },
];

function RaceChart({ rows }: { rows: CompareRow[] }) {
  const withSeries = rows.filter((r) => r.series.length > 5);
  if (withSeries.length < 2) return null;
  const W = 980;
  const H = 240;
  const all = withSeries.flatMap((r) => r.series.map((p) => p.value));
  const lo = Math.min(...all) * 0.98;
  const hi = Math.max(...all) * 1.02;
  const y = (v: number) => H - 16 - ((v - lo) / (hi - lo)) * (H - 32);
  return (
    <div className="rounded border border-[var(--line)] p-2">
      <div className="flex flex-wrap items-center gap-3 px-1 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-2)]">1-Year Race — all start at 100</span>
        {withSeries.map((r, i) => (
          <span key={r.symbol} className="flex items-center gap-1 text-[10px]">
            <span className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
            {r.symbol}
            <span className="tabular-nums text-[var(--ink-3)]">{r.series.at(-1)?.value.toFixed(0)}</span>
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <line x1={0} x2={W} y1={y(100)} y2={y(100)} stroke="rgba(148,163,184,0.3)" strokeDasharray="3 4" />
        <text x={4} y={y(100) - 3} fontSize={9} fill="rgba(148,163,184,0.7)">100</text>
        {withSeries.map((r, i) => {
          const n = r.series.length;
          const d = r.series.map((p, j) => `${j === 0 ? "M" : "L"}${((j / (n - 1)) * W).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
          return <path key={r.symbol} d={d} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth={1.8} />;
        })}
      </svg>
    </div>
  );
}

export function CompareLab({ initial }: { initial: string[] }) {
  const [input, setInput] = useState(initial.join(", "));
  const [rows, setRows] = useState<CompareRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (symbolsCsv: string) => {
    const clean = [...new Set(symbolsCsv.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 5);
    if (clean.length < 2) {
      setErr("Give at least two symbols.");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/compare?symbols=${encodeURIComponent(clean.join(","))}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setRows(json.rows as CompareRow[]);
      window.history.replaceState(null, "", `/compare?symbols=${clean.join(",")}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Comparison failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void run(initial.join(","));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = [...new Set(METRICS.map((m) => m.group))];

  return (
    <div className="flex flex-col gap-3" style={{ ["--tab-accent" as string]: "#22d3ee" }}>
      {/* Input */}
      <div className="flex flex-wrap items-center gap-2 rounded border border-[var(--line)] px-3 py-2">
        <h1 className="text-[14px] font-semibold tracking-tight">Comparison Lab</h1>
        <span className="text-[10px] text-[var(--ink-3)]">2–5 symbols, the same canonical engines as the ticker pages</span>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void run(input)}
            placeholder="AAPL, MSFT, NVDA"
            className="w-64 rounded border border-[var(--line)] bg-transparent px-2 py-1 text-[11px] outline-none focus:border-cyan-500/60"
          />
          <button
            type="button"
            onClick={() => void run(input)}
            disabled={loading}
            className="rounded border border-cyan-500/60 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-300 disabled:opacity-50"
          >
            {loading ? "…" : "Compare"}
          </button>
        </div>
      </div>

      {err && <div className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[10.5px] text-rose-300">{err}</div>}
      {loading && rows.length === 0 && (
        <div className="rounded border border-[var(--line)] p-4 text-[11px] text-[var(--ink-3)]">Assembling snapshots, decisions and risk profiles…</div>
      )}

      {rows.length >= 2 && (
        <>
          {/* Verdict header cards */}
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0,1fr))` }}>
            {rows.map((r, i) => (
              <Link key={r.symbol} href={`/ticker/${r.symbol}`} className="rounded border border-[var(--line)] p-2.5 hover:bg-white/5" style={{ borderTop: `2px solid ${COLORS[i % COLORS.length]}` }}>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[13px] font-bold">{r.symbol}</span>
                  <span className="min-w-0 flex-1 truncate text-[9px] text-[var(--ink-3)]">{r.name ?? ""}</span>
                </div>
                <div className="mt-0.5 text-[10px] text-[var(--ink-3)]">
                  {fmt.mcap(r.marketCap)} · {r.sector ?? "—"}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[9.5px] tabular-nums">
                  <span className={r.signal && ["STRONG_BUY", "BUY", "BREAKOUT_BUY", "BUY_ON_RETEST", "TACTICAL_BUY"].includes(r.signal) ? "text-emerald-400" : "text-[var(--ink-2)]"}>
                    {(r.signal ?? "—").replaceAll("_", " ")}
                  </span>
                  <span className={(r.upsidePct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}>
                    {r.upsidePct === null ? "val N/A" : `${r.upsidePct > 0 ? "+" : ""}${r.upsidePct.toFixed(0)}% upside`}
                  </span>
                </div>
              </Link>
            ))}
          </div>

          <RaceChart rows={rows} />

          {/* Matrix with best-in-row highlight */}
          <div className="overflow-x-auto rounded border border-[var(--line)]">
            <table className="grid-table w-full">
              <thead>
                <tr>
                  <th className="tl">Metric</th>
                  {rows.map((r, i) => (
                    <th key={r.symbol} style={{ color: COLORS[i % COLORS.length] }}>{r.symbol}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <>
                    <tr key={g}>
                      <td colSpan={rows.length + 1} className="tl bg-white/[0.03] text-[9px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                        {g}
                      </td>
                    </tr>
                    {METRICS.filter((m) => m.group === g).map((m) => {
                      const vals = rows.map((r) => m.get(r));
                      const present = vals.filter((v): v is number => v !== null);
                      const bestVal = m.best && present.length >= 2 ? (m.best === "high" ? Math.max(...present) : Math.min(...present)) : null;
                      return (
                        <tr key={m.label}>
                          <td className="tl text-[var(--ink-2)]" title={m.hint}>{m.label}</td>
                          {rows.map((r, i) => {
                            const isBest = bestVal !== null && vals[i] !== null && vals[i] === bestVal;
                            return (
                              <td key={r.symbol} className={`tabular-nums ${isBest ? "bg-emerald-500/10 font-bold text-emerald-300" : ""}`}>
                                {m.show(r)}
                                {isBest ? " ★" : ""}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[9.5px] text-[var(--ink-3)]">
            ★ = best in row, direction-aware (low P/E wins, shallow drawdown wins). N/A never wins and is never
            treated as zero. EG upside is INVALID where the valuation inputs failed the quality gates.
          </p>
        </>
      )}
    </div>
  );
}
