"use client";

import { useState } from "react";
import type { ChartSeries, FinancialsView, StatementTableRow } from "@/lib/engines/financials-view";

/**
 * Financials V2 (spec §23–30): SUMMARY → KEY METRICS → DETAILED, sector-aware,
 * freshness-labeled, one interactive trend chart with a metric selector.
 * Pure renderer: every number arrives precomputed from the server view-model.
 */

const money = (v: number | null): string => {
  if (v === null) return "N/A";
  const a = Math.abs(v);
  const s = a >= 1e12 ? (v / 1e12).toFixed(2) + "T" : a >= 1e9 ? (v / 1e9).toFixed(1) + "B" : a >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v.toFixed(0);
  return "$" + s;
};

const TONE = {
  POSITIVE: "text-emerald-500",
  NEGATIVE: "text-red-500",
  NEUTRAL: "text-muted-foreground",
} as const;

function Sparkline({ values }: { values: Array<number | null> }) {
  const pts = values.filter((v): v is number => v !== null);
  if (pts.length < 3) return null;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const w = 72;
  const h = 20;
  const step = w / (pts.length - 1);
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(" ");
  const up = pts[pts.length - 1]! >= pts[0]!;
  return (
    <svg width={w} height={h} className="mt-1" aria-hidden="true">
      <path d={d} fill="none" strokeWidth={1.5} className={up ? "stroke-emerald-500/70" : "stroke-red-500/70"} />
    </svg>
  );
}

const barLabel = (v: number, unit: "USD" | "PCT"): string => {
  if (unit === "PCT") return `${(v * 100).toFixed(1)}%`;
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  return v.toFixed(0);
};

function TrendChart({ series }: { series: ChartSeries[] }) {
  const [metric, setMetric] = useState(series[0]?.key ?? "revenue");
  const [mode, setMode] = useState<"quarterly" | "annual">("quarterly");
  const active = series.find((s) => s.key === metric) ?? series[0];
  if (!active) return null;
  const data = active[mode].filter((p) => p.value !== null) as Array<{ date: string; value: number }>;
  if (data.length < 2) return <div className="p-3 text-sm text-muted-foreground">Not enough history for this view.</div>;
  const vals = data.map((p) => p.value);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const W = 560;
  const H = 150;
  const TOP = 14; // headroom for the value label above each bar
  const bw = W / data.length;
  return (
    <div className="p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {series.map((s) => (
          <button
            key={s.key}
            onClick={() => setMetric(s.key)}
            className={`rounded border px-2 py-0.5 ${s.key === active.key ? "border-foreground" : "border-[var(--line)] text-muted-foreground"}`}
          >
            {s.label}
          </button>
        ))}
        <span className="mx-2 text-[var(--line)]">|</span>
        {(["quarterly", "annual"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded border px-2 py-0.5 capitalize ${m === mode ? "border-foreground" : "border-[var(--line)] text-muted-foreground"}`}
          >
            {m === "quarterly" ? "8Q" : "5Y"}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H + TOP + 18}`} className="mt-2 w-full">
        {data.map((p, i) => {
          const zero = TOP + H - ((0 - min) / span) * H;
          const y = TOP + H - ((p.value - min) / span) * H;
          const up = p.value >= 0;
          const yoy =
            mode === "quarterly" && i >= 4 && data[i - 4]!.value !== 0
              ? ((p.value - data[i - 4]!.value) / Math.abs(data[i - 4]!.value)) * 100
              : mode === "annual" && i >= 1 && data[i - 1]!.value !== 0
                ? ((p.value - data[i - 1]!.value) / Math.abs(data[i - 1]!.value)) * 100
                : null;
          return (
            <g key={p.date}>
              <title>
                {p.date} · {active.label}: {active.unit === "PCT" ? `${(p.value * 100).toFixed(2)}%` : money(p.value)}
                {yoy !== null ? ` · YoY ${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}%` : ""}
              </title>
              <rect
                x={i * bw + 3}
                y={Math.min(y, zero)}
                width={bw - 6}
                height={Math.max(2, Math.abs(zero - y))}
                className={up ? "fill-emerald-500/60 hover:fill-emerald-400/80" : "fill-red-500/60 hover:fill-red-400/80"}
              />
              {/* the number ON the bar — every bar states its value */}
              <text
                x={i * bw + bw / 2}
                y={Math.min(y, zero) - 3}
                textAnchor="middle"
                className="fill-current text-[8.5px] font-medium tabular-nums"
              >
                {barLabel(p.value, active.unit)}
              </text>
              <text x={i * bw + bw / 2} y={TOP + H + 12} textAnchor="middle" className="fill-current text-[8px] text-muted-foreground">
                {mode === "quarterly" ? p.date.slice(2, 7) : p.date.slice(0, 4)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {active.label}: {active.unit === "PCT" ? `${(data[data.length - 1]!.value * 100).toFixed(1)}%` : money(data[data.length - 1]!.value)} latest
      </div>
    </div>
  );
}

function StatementTable({ rows }: { rows: StatementTableRow[] }) {
  const cols: Array<[string, keyof StatementTableRow]> = [
    ["Revenue", "revenue"], ["Gross profit", "grossProfit"], ["Op. income", "operatingIncome"],
    ["EBITDA", "ebitda"], ["Net income", "netIncome"], ["Op. cash flow", "operatingCashFlow"],
    ["Capex", "capex"], ["FCF", "freeCashFlow"], ["Cash", "cash"], ["Total debt", "totalDebt"], ["Equity", "equity"],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="p-2">Metric</th>
            {rows.map((r) => (
              <th key={r.date} className="p-2 text-right tabular-nums">{r.date.slice(0, 7)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cols.map(([label, key]) => (
            <tr key={key} className="border-t border-[var(--line)]">
              <td className="p-2 text-muted-foreground">{label}</td>
              {rows.map((r) => (
                <td key={r.date} className="p-2 text-right tabular-nums">
                  {money(r[key] as number | null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FinancialsV2({ view }: { view: FinancialsView }) {
  const [tab, setTab] = useState<"summary" | "detailed">("summary");
  const [stKind, setStKind] = useState<"quarterly" | "annual">("quarterly");
  const f = view.freshness;

  return (
    <div>
      {/* Freshness banner — reporting-period truth, not fetch-age (spec §19/§21) */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] p-3 text-xs">
        <span className="text-muted-foreground">Latest full statements:</span>
        <span className="font-medium tabular-nums">{f.latestStatementPeriod ?? "N/A"}</span>
        {f.dataDelayed ? (
          <span className="rounded bg-amber-500/15 px-2 py-0.5 font-medium text-amber-500">
            DATA DELAYED — {f.latestReportedPeriod} reported, full statements pending
          </span>
        ) : (
          <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-emerald-500">CURRENT</span>
        )}
        <span className="ml-auto text-muted-foreground" title={`Fetched ${f.fetchedAt}`}>
          Source: {f.source.toUpperCase()} · Confidence: {f.confidence}
        </span>
      </div>

      {view.delayedHeadline && (
        <div className="border-b border-[var(--line)] p-3 text-sm">
          <span className="text-muted-foreground">Latest earnings headline ({view.delayedHeadline.periodEnd}): </span>
          EPS actual {view.delayedHeadline.epsActual ?? "N/A"} vs est. {view.delayedHeadline.epsEstimate ?? "N/A"}
          <span className="ml-2 text-xs text-muted-foreground">(not merged into the older statements below)</span>
        </div>
      )}

      {/* Financial trend headline */}
      <div className="flex items-center gap-3 p-3">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Financial trend</span>
        <span
          className={`font-semibold ${
            view.story.overall === "IMPROVING" ? "text-emerald-500" : view.story.overall === "DETERIORATING" ? "text-red-500" : ""
          }`}
        >
          {view.story.overall}
        </span>
        <span className="text-xs text-muted-foreground">
          rev {view.story.revenue.toLowerCase()} · margins {view.story.margins.toLowerCase()} · fcf {view.story.fcf.toLowerCase()} · debt {view.story.debt.toLowerCase().replace("_", " ")}
        </span>
        <div className="ml-auto flex gap-1 text-xs">
          {(["summary", "detailed"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded border px-2 py-0.5 capitalize ${tab === t ? "border-foreground" : "border-[var(--line)] text-muted-foreground"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === "summary" ? (
        <>
          {/* Key metrics — sector-aware hierarchy */}
          <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-t border-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
            {view.keyMetrics.map((m) => (
              <div key={m.key} className="p-3" title={m.tooltip}>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{m.label}</div>
                <div className="mt-1 font-medium tabular-nums">{m.display}</div>
                {m.yoyPct !== null && (
                  <div className={`text-[11px] tabular-nums ${TONE[m.interpretation ?? "NEUTRAL"]}`}>
                    {m.yoyPct > 0 ? "+" : ""}
                    {m.yoyPct.toFixed(1)}% YoY
                  </div>
                )}
                <Sparkline values={m.spark} />
              </div>
            ))}
          </div>

          {/* What changed this quarter */}
          {view.whatChanged.length > 0 && (
            <div className="border-t border-[var(--line)] p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">What changed this quarter</div>
              <div className="mt-2 grid gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                {view.whatChanged.map((c) => (
                  <div key={c.label} className="flex items-baseline justify-between gap-3 text-sm">
                    <span>{c.label}</span>
                    <span className={`tabular-nums ${TONE[c.tone]}`}>
                      {[c.qoq, c.yoy].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* What matters */}
          {view.whatMatters.length > 0 && (
            <div className="border-t border-[var(--line)] p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">What matters</div>
              <ul className="mt-1 list-disc pl-4 text-sm">
                {view.whatMatters.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* One interactive trend chart */}
          <div className="border-t border-[var(--line)]">
            <TrendChart series={view.chart} />
          </div>
        </>
      ) : (
        <div className="border-t border-[var(--line)]">
          <div className="flex gap-1 p-3 text-xs">
            {(["quarterly", "annual"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setStKind(k)}
                className={`rounded border px-2 py-0.5 capitalize ${stKind === k ? "border-foreground" : "border-[var(--line)] text-muted-foreground"}`}
              >
                {k}
              </button>
            ))}
          </div>
          <StatementTable rows={stKind === "quarterly" ? view.quarterly : view.annual} />
        </div>
      )}
    </div>
  );
}
