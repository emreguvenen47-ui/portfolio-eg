"use client";

import { useMemo, useState } from "react";
import { Chip, Kpi, Panel } from "@/components/shell/ui";
import { cn } from "@/lib/utils";
import { fmtPctPoints, fmtUsd, fmtUsdCompact, signClass } from "@/lib/format";
import type { StressScenario } from "@/lib/types";

interface StressPosition {
  code: string;
  name: string;
  value: number;
  weight: number;
  currencyCode: "USD" | "TRY" | "EUR" | "MIXED";
}

/**
 * Mirrors `runStress` in the analytics module so shocks recompute instantly as
 * the user edits, without a server round-trip. The FX rule is the same:
 * a USD/TRY shock hits TRY-denominated holdings as (1+local)/(1+Δfx)−1.
 */
function compute(positions: StressPosition[], shocks: Record<string, number>) {
  const total = positions.reduce((s, p) => s + p.value, 0) || 1;
  const fx = shocks.USDTRY ?? 0;

  const byPosition = positions.map((p) => {
    let pct = shocks[p.code.toUpperCase()] ?? 0;
    if (fx !== 0 && p.currencyCode === "TRY") pct = (1 + pct) / (1 + fx) - 1;
    return { ...p, pct, dollar: p.value * pct };
  });

  const dollarPnl = byPosition.reduce((s, p) => s + p.dollar, 0);
  const sorted = [...byPosition].sort((a, b) => a.dollar - b.dollar);
  const worst = sorted[0];
  const best = sorted[sorted.length - 1];
  return {
    byPosition,
    dollarPnl,
    portfolioPct: dollarPnl / total,
    largestLoss: worst && worst.dollar < 0 ? worst : null,
    largestHedge: best && best.dollar > 0 ? best : null,
    postValue: total + dollarPnl,
  };
}

const shocksToRecord = (s: StressScenario): Record<string, number> =>
  Object.fromEntries(s.shocks.map((x) => [x.target.toUpperCase(), x.shockPct]));

export function StressLab({
  positions,
  scenarios,
  totalValue,
}: {
  positions: StressPosition[];
  scenarios: StressScenario[];
  totalValue: number;
}) {
  const [activeId, setActiveId] = useState(scenarios[0].id);
  const [edits, setEdits] = useState<Record<string, Record<string, number>>>(() =>
    Object.fromEntries(scenarios.map((s) => [s.id, shocksToRecord(s)])),
  );

  const scenario = scenarios.find((s) => s.id === activeId)!;
  const shocks = edits[activeId] ?? {};
  const result = useMemo(() => compute(positions, shocks), [positions, shocks]);

  const setShock = (target: string, pct: number) =>
    setEdits((prev) => ({ ...prev, [activeId]: { ...prev[activeId], [target]: pct } }));

  const removeShock = (target: string) =>
    setEdits((prev) => {
      const next = { ...prev[activeId] };
      delete next[target];
      return { ...prev, [activeId]: next };
    });

  const reset = () =>
    setEdits((prev) => ({ ...prev, [activeId]: shocksToRecord(scenario) }));

  const shockKeys = Object.keys(shocks);
  const unshocked = positions
    .map((p) => p.code.toUpperCase())
    .filter((c) => !shockKeys.includes(c));

  // Compare every scenario side by side under current edits.
  const comparison = scenarios.map((s) => ({
    id: s.id,
    name: s.name,
    ...compute(positions, edits[s.id] ?? shocksToRecord(s)),
  }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {scenarios.map((s) => {
          const r = comparison.find((c) => c.id === s.id)!;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveId(s.id)}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-sm border px-2.5 py-1.5 text-left transition-colors",
                activeId === s.id
                  ? "border-[var(--amber)]/50 bg-[rgba(255,160,40,0.1)]"
                  : "border-[var(--line)] bg-[var(--panel)] hover:border-[var(--ink-3)]",
              )}
            >
              <span className="text-[11px] font-semibold">{s.name}</span>
              <span className={cn("tnum text-[13px] font-bold", signClass(r.portfolioPct))}>
                {fmtPctPoints(r.portfolioPct * 100)}
              </span>
              <span className="tnum text-[9.5px] text-[var(--ink-3)]">
                {fmtUsdCompact(r.dollarPnl)}
              </span>
            </button>
          );
        })}
      </div>

      <Panel bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-5">
          <Kpi
            label="Portfolio Impact"
            value={fmtPctPoints(result.portfolioPct * 100)}
            tone={result.portfolioPct >= 0 ? "pos" : "neg"}
            sub={scenario.name}
          />
          <Kpi
            label="Dollar P&L"
            value={fmtUsd(result.dollarPnl)}
            tone={result.dollarPnl >= 0 ? "pos" : "neg"}
          />
          <Kpi
            label="Post-Shock Value"
            value={fmtUsd(result.postValue)}
            sub={`from ${fmtUsdCompact(totalValue)}`}
          />
          <Kpi
            label="Largest Loss"
            value={result.largestLoss ? result.largestLoss.code : "—"}
            sub={result.largestLoss ? fmtUsdCompact(result.largestLoss.dollar) : undefined}
            tone="neg"
          />
          <Kpi
            label="Largest Hedge"
            value={result.largestHedge ? result.largestHedge.code : "—"}
            sub={
              result.largestHedge
                ? fmtUsdCompact(result.largestHedge.dollar)
                : "no position gains"
            }
            tone="pos"
          />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[380px_1fr]">
        <Panel
          title="Scenario Assumptions"
          subtitle={scenario.description}
          actions={
            <button
              type="button"
              onClick={reset}
              className="text-[10px] text-[var(--ink-3)] hover:text-[var(--amber)]"
            >
              Reset
            </button>
          }
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-[var(--line-soft)]">
            {shockKeys.map((k) => (
              <li key={k} className="flex items-center gap-2 px-3 py-1.5">
                <span className="w-16 shrink-0 text-[11px] font-semibold">{k}</span>
                <input
                  type="range"
                  min={-60}
                  max={60}
                  step={1}
                  value={Math.round(shocks[k] * 100)}
                  onChange={(e) => setShock(k, Number(e.target.value) / 100)}
                  className="h-1 flex-1 cursor-pointer appearance-none rounded bg-[var(--panel-2)] accent-[var(--amber)]"
                />
                <input
                  type="number"
                  value={Math.round(shocks[k] * 100)}
                  onChange={(e) => setShock(k, Number(e.target.value) / 100)}
                  className="tnum w-14 rounded-sm border border-[var(--line)] bg-[var(--bg)] px-1 py-0.5 text-right text-[11px]"
                />
                <span className="text-[10px] text-[var(--ink-3)]">%</span>
                <button
                  type="button"
                  onClick={() => removeShock(k)}
                  className="text-[13px] leading-none text-[var(--ink-3)] hover:text-[var(--down)]"
                  aria-label={`Remove ${k} shock`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-1 border-t border-[var(--line)] p-2">
            <span className="text-[9.5px] uppercase tracking-wider text-[var(--ink-3)]">
              Add shock
            </span>
            {!shockKeys.includes("USDTRY") && (
              <button
                type="button"
                onClick={() => setShock("USDTRY", 0.1)}
                className="chip border-[var(--line)] hover:border-[var(--amber)]"
              >
                + USDTRY
              </button>
            )}
            {unshocked.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setShock(c, -0.1)}
                className="chip border-[var(--line)] hover:border-[var(--amber)]"
              >
                + {c}
              </button>
            ))}
          </div>
          <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] leading-relaxed text-[var(--ink-3)]">
            A <strong>USDTRY</strong> shock is applied on top of any direct shock for
            TRY-denominated holdings as (1+local)/(1+Δfx)−1, so a lira move hits PPF and BIST
            in USD terms even when their local prices are unchanged.
          </div>
        </Panel>

        <Panel title="Position Impact" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Code</th>
                  <th className="tl">Asset</th>
                  <th>Weight</th>
                  <th>Value</th>
                  <th>Shock</th>
                  <th>P&amp;L</th>
                  <th>Post Value</th>
                  <th>Impact on Portfolio</th>
                </tr>
              </thead>
              <tbody>
                {[...result.byPosition]
                  .sort((a, b) => a.dollar - b.dollar)
                  .map((p) => (
                    <tr key={p.code}>
                      <td className="tl font-semibold">{p.code}</td>
                      <td className="tl max-w-[200px] truncate text-[var(--ink-2)]">{p.name}</td>
                      <td className="text-[var(--ink-3)]">{(p.weight * 100).toFixed(2)}%</td>
                      <td>{fmtUsdCompact(p.value)}</td>
                      <td className={signClass(p.pct)}>
                        {p.pct === 0 ? "—" : fmtPctPoints(p.pct * 100)}
                      </td>
                      <td className={signClass(p.dollar)}>
                        {p.dollar === 0 ? "—" : fmtUsdCompact(p.dollar)}
                      </td>
                      <td>{fmtUsdCompact(p.value + p.dollar)}</td>
                      <td className={signClass(p.dollar)}>
                        {p.dollar === 0
                          ? "—"
                          : fmtPctPoints((p.dollar / (totalValue || 1)) * 100)}
                      </td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--line)] bg-[var(--panel-2)] font-semibold">
                  <td className="tl px-2 py-1.5" colSpan={5}>
                    TOTAL
                  </td>
                  <td className={cn("px-2 py-1.5 text-right tnum", signClass(result.dollarPnl))}>
                    {fmtUsdCompact(result.dollarPnl)}
                  </td>
                  <td className="px-2 py-1.5 text-right tnum">{fmtUsdCompact(result.postValue)}</td>
                  <td className={cn("px-2 py-1.5 text-right tnum", signClass(result.portfolioPct))}>
                    {fmtPctPoints(result.portfolioPct * 100)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Panel>
      </div>

      <Panel title="Scenario Comparison" bodyClassName="p-0">
        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">Scenario</th>
              <th>Portfolio %</th>
              <th>Dollar P&amp;L</th>
              <th>Post-Shock Value</th>
              <th className="tl">Largest Loss</th>
              <th className="tl">Largest Hedge</th>
            </tr>
          </thead>
          <tbody>
            {comparison.map((c) => (
              <tr key={c.id}>
                <td className="tl">
                  {c.name}
                  {c.id === activeId && (
                    <Chip tone="amber">
                      <span className="ml-1">active</span>
                    </Chip>
                  )}
                </td>
                <td className={cn("font-semibold", signClass(c.portfolioPct))}>
                  {fmtPctPoints(c.portfolioPct * 100)}
                </td>
                <td className={signClass(c.dollarPnl)}>{fmtUsdCompact(c.dollarPnl)}</td>
                <td>{fmtUsdCompact(c.postValue)}</td>
                <td className="tl text-[var(--down)]">
                  {c.largestLoss ? `${c.largestLoss.code} ${fmtUsdCompact(c.largestLoss.dollar)}` : "—"}
                </td>
                <td className="tl text-[var(--up)]">
                  {c.largestHedge
                    ? `${c.largestHedge.code} ${fmtUsdCompact(c.largestHedge.dollar)}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
