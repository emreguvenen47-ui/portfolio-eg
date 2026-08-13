"use client";

import { useMemo, useState } from "react";
import { Chip, Note, Panel } from "@/components/shell/ui";
import { fmtPctPoints, signClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  defaultVolatilityFor,
  snapshot,
  type ExposureBucket,
  type WhatIfPosition,
} from "@/lib/portfolio/what-if";
import type { AssetClass, Region } from "@/lib/types";

const ASSET_CLASSES: AssetClass[] = ["Equity", "Commodity", "Alternative", "Cash", "Unallocated"];
const REGIONS: Region[] = ["US", "Europe", "China", "EM", "Turkey", "Global", "Unallocated"];

function Row({
  label,
  before,
  after,
  unit = "%",
  invert = false,
  digits = 1,
}: {
  label: string;
  before: number;
  after: number;
  unit?: string;
  /** True when lower is better, so the delta colour flips. */
  invert?: boolean;
  digits?: number;
}) {
  const delta = after - before;
  const good = invert ? -delta : delta;
  return (
    <tr>
      <td className="tl">{label}</td>
      <td className="tabular-nums text-[var(--ink-3)]">
        {before.toFixed(digits)}
        {unit}
      </td>
      <td className="tabular-nums">
        {after.toFixed(digits)}
        {unit}
      </td>
      <td className={cn("tabular-nums", signClass(good))}>
        {delta >= 0 ? "+" : ""}
        {delta.toFixed(digits)}
        {unit === "%" ? "pp" : unit}
      </td>
    </tr>
  );
}

function BucketDiff({
  title,
  before,
  after,
}: {
  title: string;
  before: ExposureBucket[];
  after: ExposureBucket[];
}) {
  const keys = [...new Set([...before, ...after].map((b) => b.label))];
  const get = (xs: ExposureBucket[], k: string) =>
    (xs.find((x) => x.label === k)?.weight ?? 0) * 100;

  return (
    <Panel title={title} bodyClassName="p-0">
      <table className="grid-table">
        <thead>
          <tr>
            <th className="tl">Bucket</th>
            <th>Before</th>
            <th>After</th>
            <th>Δ</th>
          </tr>
        </thead>
        <tbody>
          {keys
            .sort((a, b) => get(after, b) - get(after, a))
            .map((k) => {
              const b = get(before, k);
              const a = get(after, k);
              return (
                <tr key={k}>
                  <td className="tl">{k}</td>
                  <td className="tabular-nums text-[var(--ink-3)]">{b.toFixed(1)}%</td>
                  <td className="tabular-nums">{a.toFixed(1)}%</td>
                  <td className={cn("tabular-nums", signClass(a - b))}>
                    {a - b >= 0 ? "+" : ""}
                    {(a - b).toFixed(1)}pp
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </Panel>
  );
}

/**
 * Portfolio what-if.
 *
 * Entirely client-side and entirely temporary — there is no save path from
 * here into the workbook, which is the point: the simulator has to be safe to
 * poke at. BEFORE is recomputed from the untouched starting state on every
 * render, so the comparison never drifts.
 */
export function WhatIfSimulator({ initial }: { initial: WhatIfPosition[] }) {
  const [positions, setPositions] = useState<WhatIfPosition[]>(initial);
  const [cash, setCash] = useState("0");

  const [newCode, setNewCode] = useState("");
  const [newWeight, setNewWeight] = useState("5");
  const [newClass, setNewClass] = useState<AssetClass>("Equity");
  const [newRegion, setNewRegion] = useState<Region>("US");

  const withCash = useMemo(() => {
    const extra = Math.max(0, Number(cash) || 0) / 100;
    if (extra <= 0) return positions;
    return [
      ...positions,
      {
        code: "CASH",
        name: "Added cash",
        weight: extra,
        assetClass: "Cash" as AssetClass,
        region: "US" as Region,
        volatility: 0.01,
        currency: "USD",
        theme: "Liquidity",
        source: "added" as const,
      },
    ];
  }, [positions, cash]);

  const before = useMemo(() => snapshot(initial), [initial]);
  const after = useMemo(() => snapshot(withCash), [withCash]);

  const total = withCash.reduce((s, p) => s + p.weight, 0) * 100;
  const changed =
    positions.length !== initial.length ||
    Number(cash) > 0 ||
    positions.some((p, i) => initial[i]?.code !== p.code || initial[i]?.weight !== p.weight);

  const add = () => {
    const code = newCode.trim().toUpperCase();
    if (!code || positions.some((p) => p.code === code)) return;
    setPositions((cur) => [
      ...cur,
      {
        code,
        name: code,
        weight: Math.max(0, Number(newWeight) || 0) / 100,
        assetClass: newClass,
        region: newRegion,
        volatility: defaultVolatilityFor(newClass),
        currency: newRegion === "Turkey" ? "TRY" : newRegion === "Europe" ? "EUR" : "USD",
        theme: "Untagged",
        source: "added",
      },
    ]);
    setNewCode("");
  };

  return (
    <div className="flex flex-col gap-3">
      <Note tone="info">
        <span>
          <strong>Simulation only.</strong> Nothing here touches the real portfolio — there is no
          save path from this page. Volatility is model-implied from factor loadings on both
          sides so BEFORE and AFTER are comparable; it will not match the covariance-based figure
          on the Risk page.
        </span>
      </Note>

      {/* ------------------------------------------------------------ edit */}
      <Panel title="Adjust Allocation" bodyClassName="p-0">
        <div className="flex flex-wrap items-end gap-2 border-b border-[var(--line)] p-3">
          <label className="flex flex-col gap-1">
            <span className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
              Add asset
            </span>
            <input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value.toUpperCase())}
              placeholder="AVUV"
              className="w-24 rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[11px] uppercase outline-none focus:border-[var(--amber)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
              Weight %
            </span>
            <input
              value={newWeight}
              onChange={(e) => setNewWeight(e.target.value.replace(/[^\d.]/g, ""))}
              className="w-20 rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[11px] tabular-nums outline-none focus:border-[var(--amber)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
              Class
            </span>
            <select
              value={newClass}
              onChange={(e) => setNewClass(e.target.value as AssetClass)}
              className="rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[11px] outline-none focus:border-[var(--amber)]"
            >
              {ASSET_CLASSES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
              Region
            </span>
            <select
              value={newRegion}
              onChange={(e) => setNewRegion(e.target.value as Region)}
              className="rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[11px] outline-none focus:border-[var(--amber)]"
            >
              {REGIONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={add}
            className="rounded-sm border border-[var(--line)] px-3 py-1 text-[10.5px] uppercase tracking-[0.08em] text-[var(--ink-2)] hover:border-[var(--amber)] hover:text-[var(--amber)]"
          >
            Add
          </button>

          <label className="ml-auto flex flex-col gap-1">
            <span className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
              Extra cash %
            </span>
            <input
              value={cash}
              onChange={(e) => setCash(e.target.value.replace(/[^\d.]/g, ""))}
              className="w-20 rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[11px] tabular-nums outline-none focus:border-[var(--amber)]"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setPositions(initial);
              setCash("0");
            }}
            className="text-[10.5px] text-[var(--ink-3)] hover:text-[var(--ink)]"
          >
            Reset
          </button>
        </div>

        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">Code</th>
              <th className="tl">Class / Region</th>
              <th>Weight %</th>
              <th className="tl" />
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.code}>
                <td className="tl font-semibold">
                  {p.code}
                  {p.source === "added" && (
                    <span className="ml-2">
                      <Chip tone="amber">ADDED</Chip>
                    </span>
                  )}
                </td>
                <td className="tl text-[10px] text-[var(--ink-3)]">
                  {p.assetClass} / {p.region}
                </td>
                <td>
                  <input
                    value={(p.weight * 100).toFixed(2).replace(/\.?0+$/, "")}
                    onChange={(e) =>
                      setPositions((cur) =>
                        cur.map((x) =>
                          x.code === p.code
                            ? {
                                ...x,
                                weight:
                                  Math.max(0, Number(e.target.value.replace(/[^\d.]/g, "")) || 0) /
                                  100,
                              }
                            : x,
                        ),
                      )
                    }
                    className="w-20 rounded-sm border border-[var(--line)] bg-[var(--bg)] px-1.5 py-0.5 text-right text-[11px] tabular-nums outline-none focus:border-[var(--amber)]"
                  />
                </td>
                <td className="tl">
                  <button
                    type="button"
                    onClick={() => setPositions((cur) => cur.filter((x) => x.code !== p.code))}
                    className="text-[12px] text-[var(--ink-3)] hover:text-[var(--down)]"
                    aria-label={`Remove ${p.code}`}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="tl font-semibold" colSpan={2}>
                TOTAL
              </td>
              <td className="tabular-nums font-semibold">{total.toFixed(1)}%</td>
              <td className="tl">
                {Math.abs(total - 100) > 0.05 && (
                  <span
                    className="text-[9.5px] text-[var(--ink-3)]"
                    title="Exposures below are normalised, so a total other than 100% still compares like for like."
                  >
                    normalised
                  </span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </Panel>

      {/* --------------------------------------------------- before / after */}
      <Panel
        title="Before vs After"
        subtitle={changed ? "showing your simulated allocation" : "no changes yet"}
        bodyClassName="p-0"
      >
        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">Measure</th>
              <th>Before</th>
              <th>After</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            <Row
              label="Model-implied volatility"
              before={before.volatility * 100}
              after={after.volatility * 100}
              invert
            />
            <Row
              label="Largest position"
              before={before.largestWeight * 100}
              after={after.largestWeight * 100}
              invert
            />
            <Row
              label="Effective positions"
              before={before.effectivePositions}
              after={after.effectivePositions}
              unit=""
            />
          </tbody>
        </table>
      </Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
        <BucketDiff title="Asset Class" before={before.byAssetClass} after={after.byAssetClass} />
        <BucketDiff title="Region" before={before.byRegion} after={after.byRegion} />
        <BucketDiff title="Currency" before={before.byCurrency} after={after.byCurrency} />
        <BucketDiff title="Theme" before={before.byTheme} after={after.byTheme} />
      </div>

      <Panel
        title="Stress Impact"
        subtitle="rule-based shocks applied to both allocations"
        bodyClassName="p-0"
      >
        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">Scenario</th>
              <th>Before</th>
              <th>After</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {after.stress.map((s) => {
              const b = before.stress.find((x) => x.id === s.id)?.impactPct ?? 0;
              return (
                <tr key={s.id}>
                  <td className="tl">{s.name}</td>
                  <td className={cn("tabular-nums", signClass(b))}>{fmtPctPoints(b)}</td>
                  <td className={cn("tabular-nums", signClass(s.impactPct))}>
                    {fmtPctPoints(s.impactPct)}
                  </td>
                  <td className={cn("tabular-nums", signClass(s.impactPct - b))}>
                    {s.impactPct - b >= 0 ? "+" : ""}
                    {(s.impactPct - b).toFixed(2)}pp
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
