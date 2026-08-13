"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Chip, Note } from "@/components/shell/ui";
import { cn } from "@/lib/utils";
import { TIMEFRAMES, type Timeframe } from "@/lib/rotation/sectors";
import type { GroupRotation } from "@/lib/rotation/engine";

interface Payload {
  groups: GroupRotation[];
  benchmark: string;
  timeframe: Timeframe;
  actualFlowGroups: number;
  signalGroups: number;
  warming: number;
  map: { out: GroupRotation[]; into: GroupRotation[]; supported: boolean; note: string };
}

const STATE_TONE: Record<string, "pos" | "neg" | "neutral"> = {
  "STRONG ROTATION IN": "pos",
  "ROTATION IN": "pos",
  NEUTRAL: "neutral",
  "ROTATION OUT": "neg",
  "STRONG ROTATION OUT": "neg",
};

const cellTone = (v: number | null) =>
  v === null ? "text-[var(--ink-3)]" : v > 0.5 ? "text-emerald-400" : v < -0.5 ? "text-rose-400" : "";

const arrow = (d: "up" | "flat" | "down") => (d === "up" ? "↑" : d === "down" ? "↓" : "→");

const pp = (v: number | null) => (v === null ? "N/A" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);

export function RotationView() {
  const [tf, setTf] = useState<Timeframe>("1W");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    // A poll refreshes in place; only a timeframe change is worth a spinner.
    if (refresh === 0) setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/rotation?tf=${tf}`, { signal: ctl.signal });
        setData(await res.json());
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") setData(null);
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctl.abort();
  }, [tf, refresh]);

  // Reset the poll counter when the timeframe changes, so the new window gets
  // its own loading state.
  useEffect(() => {
    setRefresh(0);
  }, [tf]);

  /**
   * Constituent histories arrive in the background, and the breadth columns —
   * plus the scores that read them — move as they land. Poll until they stop.
   */
  useEffect(() => {
    if (!data || data.warming <= 0) return;
    const t = setTimeout(() => setRefresh((n) => n + 1), 5_000);
    return () => clearTimeout(t);
  }, [data]);

  const sectors = useMemo(
    () => (data?.groups ?? []).filter((g) => g.group.kind === "sector"),
    [data],
  );
  const subs = useMemo(
    () => (data?.groups ?? []).filter((g) => g.group.kind === "subsector"),
    [data],
  );
  const inflections = useMemo(
    () => (data?.groups ?? []).filter((g) => g.inflection !== null),
    [data],
  );

  return (
    <div className="flex flex-col gap-3">
      <Note tone="warn">
        <span>
          <strong>Rotation signal, not fund flow.</strong> Nothing here observes money moving. Every
          figure is derived from price, relative strength, breadth and volume — that is evidence of
          shifting leadership, not of net capital entering a sector. No ETF creation/redemption
          source is configured, so no group on this page reports an actual flow.
        </span>
      </Note>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Sector Flows</h2>
          <span className="text-[10px] text-[var(--ink-3)]">
            relative to {data?.benchmark ?? "SPY"}
          </span>
          <span className="ml-auto flex gap-1">
            {TIMEFRAMES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTf(t.key)}
                className={cn(
                  "rounded-sm border px-2 py-0.5 text-[10px]",
                  tf === t.key
                    ? "border-[var(--amber)] bg-[rgba(255,160,40,0.12)] text-[var(--amber)]"
                    : "border-[var(--line)] text-[var(--ink-3)] hover:border-[var(--ink-3)]",
                )}
              >
                {t.key}
              </button>
            ))}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
          <span>
            DATA TYPE:{" "}
            <span className="text-amber-400">MARKET ROTATION SIGNAL</span> ·{" "}
            {data?.signalGroups ?? 0} groups
          </span>
          <span>
            ACTUAL FUND FLOW: <span className="text-[var(--ink-2)]">{data?.actualFlowGroups ?? 0}</span> groups
            — no provider configured
          </span>
          {(data?.warming ?? 0) > 0 ? (
            <span className="text-[var(--amber)]">
              BREADTH LOADING — {data!.warming} constituent histories still arriving; the breadth
              columns and the scores that read them will move
            </span>
          ) : (
            data && <span className="text-[var(--green)]">BREADTH COMPLETE</span>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------- rotation map */}
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Rotation Map</h2>
          <span className="text-[10px] text-[var(--ink-3)]">{tf} leadership</span>
        </div>
        {!data?.map.supported ? (
          <div className="px-3 py-3 text-[10.5px] leading-snug text-[var(--ink-3)]">
            {data?.map.note ||
              "Not enough dispersion between sectors to describe this as rotation rather than ordinary noise."}
          </div>
        ) : (
          <div className="grid grid-cols-1 divide-y divide-[var(--line)] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <div className="px-3 py-2">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-rose-400">Out of</div>
              {data.map.out.length === 0 ? (
                <p className="text-[10px] text-[var(--ink-3)]">No sector is lagging materially.</p>
              ) : (
                <ul className="space-y-1">
                  {data.map.out.map((g) => (
                    <li key={g.group.id} className="text-[11px]">
                      <span className="font-semibold">{g.group.label}</span>{" "}
                      <span className="text-rose-400 tabular-nums">
                        {pp(g.cells.find((c) => c.timeframe === tf)?.relative ?? null)}
                      </span>
                      <span className="block text-[9.5px] text-[var(--ink-3)]">{g.why[0]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="px-3 py-2">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-emerald-400">Into</div>
              {data.map.into.length === 0 ? (
                <p className="text-[10px] text-[var(--ink-3)]">No sector is leading materially.</p>
              ) : (
                <ul className="space-y-1">
                  {data.map.into.map((g) => (
                    <li key={g.group.id} className="text-[11px]">
                      <span className="font-semibold">{g.group.label}</span>{" "}
                      <span className="text-emerald-400 tabular-nums">
                        {pp(g.cells.find((c) => c.timeframe === tf)?.relative ?? null)}
                      </span>
                      <span className="block text-[9.5px] text-[var(--ink-3)]">{g.why[0]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
          {data?.map.note} Describes what has already happened; it is not a forecast.
        </div>
      </section>

      {/* ------------------------------------------------------- inflections */}
      {inflections.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Inflections</h2>
            <span className="text-[10px] text-[var(--ink-3)]">
              short horizon disagreeing with the long one
            </span>
          </div>
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Group</th>
                <th className="tl">Signal</th>
                <th>1W</th>
                <th>1M</th>
                <th>6M</th>
                <th>Breadth 50DMA</th>
              </tr>
            </thead>
            <tbody>
              {inflections.map((g) => (
                <tr key={g.group.id}>
                  <td className="tl font-semibold">{g.group.label}</td>
                  <td className="tl">
                    <Chip tone={g.inflection === "EARLY ROTATION" ? "pos" : "neg"}>
                      {g.inflection}
                    </Chip>
                  </td>
                  {(["1W", "1M", "6M"] as Timeframe[]).map((t) => {
                    const c = g.cells.find((x) => x.timeframe === t);
                    return (
                      <td key={t} className={cn("tabular-nums", cellTone(c?.relative ?? null))}>
                        {pp(c?.relative ?? null)}
                      </td>
                    );
                  })}
                  <td className="tabular-nums">
                    {g.breadth.above50 === null ? "N/A" : `${g.breadth.above50.toFixed(0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
            An observation that the recent trend differs from the established one. Not a prediction
            that it continues.
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------ matrix */}
      {[
        { title: "Sectors", rows: sectors },
        { title: "Sub-sectors", rows: subs },
      ].map(({ title, rows }) => (
        <section key={title} className="panel">
          <div className="panel-head">
            <h2 className="panel-title">{title}</h2>
            <span className="text-[10px] text-[var(--ink-3)]">
              relative return vs {data?.benchmark ?? "SPY"}, per window
            </span>
          </div>
          {loading && !data ? (
            <div className="p-4 text-[11px] text-[var(--ink-3)]">Computing rotation…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th className="tl">Group</th>
                    <th className="tl">Proxy</th>
                    {TIMEFRAMES.map((t) => (
                      <th key={t.key}>{t.key}</th>
                    ))}
                    <th>Score</th>
                    <th>Breadth</th>
                    <th className="tl">State</th>
                    <th className="tl">Coverage</th>
                    <th className="tl"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((g) => {
                    const isOpen = open === g.group.id;
                    return (
                      <>
                        <tr
                          key={g.group.id}
                          onClick={() => setOpen(isOpen ? null : g.group.id)}
                          className="cursor-pointer hover:bg-[var(--panel-2)]"
                        >
                          <td className="tl font-semibold">{g.group.label}</td>
                          <td className="tl text-[10px] text-[var(--ink-3)]">{g.group.proxy}</td>
                          {TIMEFRAMES.map((t) => {
                            const c = g.cells.find((x) => x.timeframe === t.key);
                            return (
                              <td
                                key={t.key}
                                className={cn("tabular-nums", cellTone(c?.relative ?? null))}
                                title={
                                  c?.ret === null || c?.ret === undefined
                                    ? "no data"
                                    : `${g.group.proxy} ${pp(c.ret)} vs benchmark ${pp(c.benchmarkRet)}`
                                }
                              >
                                {pp(c?.relative ?? null)} {c ? arrow(c.direction) : ""}
                              </td>
                            );
                          })}
                          <td className="tabular-nums font-semibold">{g.score ?? "N/A"}</td>
                          <td className="tabular-nums text-[10px]">
                            {g.breadth.above50 === null
                              ? "N/A"
                              : `${g.breadth.above50.toFixed(0)}%`}
                            <span className="ml-1 text-[8.5px] text-[var(--ink-3)]">
                              n={g.breadth.sample}
                            </span>
                          </td>
                          <td className="tl">
                            <Chip tone={STATE_TONE[g.state]}>{g.state}</Chip>
                          </td>
                          <td className="tl text-[9.5px] text-[var(--ink-3)]">
                            {g.coverage.have}/{g.coverage.total}
                          </td>
                          <td className="tl">
                            <div className="flex gap-2">
                              <Link
                                href={`/rotation/${g.group.id}?tf=${tf}`}
                                onClick={(e) => e.stopPropagation()}
                                className="whitespace-nowrap text-[9.5px] text-[var(--amber)] hover:underline"
                              >
                                NAMES →
                              </Link>
                              {g.group.sector && (
                                <Link
                                  href={`/screener?sector=${encodeURIComponent(g.group.sector)}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="whitespace-nowrap text-[9.5px] text-[var(--amber)] hover:underline"
                                >
                                  SCREEN →
                                </Link>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr key={`${g.group.id}-d`}>
                            <td colSpan={TIMEFRAMES.length + 7} className="tl bg-[var(--panel-2)] p-0">
                              <Detail g={g} />
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] leading-snug text-[var(--ink-3)]">
            Cells show the group&apos;s return less the benchmark&apos;s over the same window.
            Breadth is the share of sampled constituents above their 50-day average, with the
            sample size shown — a thin sample is not a sector reading. Click a row for the
            components behind its score.
          </div>
        </section>
      ))}
    </div>
  );
}

function Detail({ g }: { g: GroupRotation }) {
  return (
    <div className="grid grid-cols-1 divide-y divide-[var(--line)] lg:grid-cols-3 lg:divide-x lg:divide-y-0">
      <div className="px-3 py-2">
        <div className="mb-1 text-[9.5px] uppercase tracking-wide text-[var(--ink-3)]">Why</div>
        <ul className="list-disc space-y-0.5 pl-4">
          {g.why.map((w, i) => (
            <li key={i} className="text-[10px] leading-snug">{w}</li>
          ))}
        </ul>
      </div>
      <div className="px-3 py-2">
        <div className="mb-1 text-[9.5px] uppercase tracking-wide text-[var(--ink-3)]">
          Score components
        </div>
        <table className="w-full text-[10px]">
          <tbody>
            {g.components.map((c) => (
              <tr key={c.key}>
                <td className="text-[var(--ink-3)]">{c.label}</td>
                <td className="text-right tabular-nums">{c.score}</td>
                <td className="pl-2 text-right text-[9px] text-[var(--ink-3)]">{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-2">
        <div className="mb-1 text-[9.5px] uppercase tracking-wide text-[var(--ink-3)]">Breadth</div>
        <table className="w-full text-[10px]">
          <tbody>
            <tr>
              <td className="text-[var(--ink-3)]">Above 20DMA</td>
              <td className="text-right tabular-nums">
                {g.breadth.above20 === null ? "N/A" : `${g.breadth.above20.toFixed(0)}%`}
              </td>
            </tr>
            <tr>
              <td className="text-[var(--ink-3)]">Above 50DMA</td>
              <td className="text-right tabular-nums">
                {g.breadth.above50 === null ? "N/A" : `${g.breadth.above50.toFixed(0)}%`}
              </td>
            </tr>
            <tr>
              <td className="text-[var(--ink-3)]">Above 200DMA</td>
              <td className="text-right tabular-nums">
                {g.breadth.above200 === null ? "N/A" : `${g.breadth.above200.toFixed(0)}%`}
              </td>
            </tr>
            <tr>
              <td className="text-[var(--ink-3)]">Advancing / declining</td>
              <td className="text-right tabular-nums">
                {g.breadth.advancing === null ? "N/A" : `${g.breadth.advancing} / ${g.breadth.declining}`}
              </td>
            </tr>
            <tr>
              <td className="text-[var(--ink-3)]">Sample</td>
              <td className="text-right tabular-nums">{g.breadth.sample}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-[9px] text-[var(--ink-3)]">
          DATA TYPE: {g.dataType === "ACTUAL_FUND_FLOW" ? "ACTUAL FUND FLOW" : "MARKET ROTATION SIGNAL"}
        </p>
      </div>
    </div>
  );
}
