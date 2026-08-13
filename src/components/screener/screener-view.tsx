"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Chip, Note } from "@/components/shell/ui";
import { cn } from "@/lib/utils";
import { currencySymbol } from "@/lib/format-currency";
import { SECTOR_LIST } from "@/lib/scanner/score";
import { CAP_BUCKET_LABEL, type CapBucket, type Region, type Sector } from "@/lib/scanner/types";
import {
  METRICS,
  METRIC_BY_KEY,
  METRIC_GROUPS,
  formatMetric,
  type MetricKey,
} from "@/lib/screener/metrics";
import type { Basis, Comparator, Criterion, Screen } from "@/lib/screener/filter";
import type { ScreenRowOut } from "@/lib/screener/run";

const BUCKETS: CapBucket[] = ["MICRO", "SMALL", "MID", "LARGE", "MEGA"];

const COMPARATORS: { key: Comparator; label: string }[] = [
  { key: "lt", label: "<" },
  { key: "lte", label: "≤" },
  { key: "gt", label: ">" },
  { key: "gte", label: "≥" },
  { key: "between", label: "between" },
];

const BASES: { key: Basis; label: string; hint: string }[] = [
  { key: "absolute", label: "value", hint: "A fixed number." },
  { key: "sectorMedian", label: "× sector median", hint: "Multiple of the sector median. Leave the number empty for the median itself." },
  { key: "industryMedian", label: "× industry median", hint: "Multiple of the industry median." },
  { key: "sectorPercentile", label: "sector percentile", hint: "0–100, where 100 is best for this metric." },
  { key: "industryPercentile", label: "industry percentile", hint: "0–100, where 100 is best for this metric." },
];

const DEFAULT_COLUMNS: MetricKey[] = [
  "marketCap",
  "evEbitda",
  "pe",
  "revenueGrowth",
  "roic",
  "netDebtToEbitda",
  "fcfYield",
  "return12m",
  "relativeStrength",
];

interface Payload {
  rows: ScreenRowOut[];
  eligible: number;
  dataAvailable: number;
  matches: number;
  analyzing: number;
  universe: number;
  rejected: { failed: number; noData: number; noPeers: number };
}

/** A saved screen as the list endpoint returns it. */
interface SavedScreenSummary {
  id: string;
  name: string;
  pool: {
    regions?: string[];
    sectors?: string[];
    buckets?: string[];
    minDollarVolume?: number | null;
    minPrice?: number | null;
  };
  combinator: "AND" | "OR";
  criteria: Criterion[];
  columns?: string[];
  updatedAt: string;
}

const uid = () => `c${Math.floor(performance.now() * 1000)}${METRICS.length}`;

export function ScreenerView({ initialSector }: { initialSector?: string }) {
  const [regions, setRegions] = useState<Region[]>(["US"]);
  const [sectors, setSectors] = useState<Sector[]>(
    initialSector && (SECTOR_LIST as string[]).includes(initialSector)
      ? [initialSector as Sector]
      : [],
  );
  const [buckets, setBuckets] = useState<CapBucket[]>([]);
  const [minPrice, setMinPrice] = useState<string>("");
  const [minVol, setMinVol] = useState<string>("");
  const [combinator, setCombinator] = useState<"AND" | "OR">("AND");
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [columns, setColumns] = useState<MetricKey[]>(DEFAULT_COLUMNS);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<MetricKey | "symbol">("marketCap");
  const [drawer, setDrawer] = useState<ScreenRowOut | null>(null);
  const [ran, setRan] = useState(false);
  const [saved, setSaved] = useState<SavedScreenSummary[]>([]);
  const [screenId, setScreenId] = useState<string | null>(null);
  const [screenName, setScreenName] = useState("");
  const [saveState, setSaveState] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(60);

  const screen: Screen = useMemo(
    () => ({ id: "adhoc", name: "Ad hoc", combinator, criteria }),
    [combinator, criteria],
  );

  const pool = useMemo(
    () => ({
      regions,
      sectors,
      industries: [] as string[],
      buckets,
      minMarketCap: null,
      maxMarketCap: null,
      minDollarVolume: minVol ? Number(minVol) : null,
      minPrice: minPrice ? Number(minPrice) : null,
    }),
    [regions, sectors, buckets, minVol, minPrice],
  );

  const loadSaved = async () => {
    try {
      const r = await fetch("/api/screener/saved");
      const j = (await r.json()) as { screens?: SavedScreenSummary[] };
      setSaved(j.screens ?? []);
    } catch {
      /* saved screens are optional; the screener works without them */
    }
  };

  useEffect(() => {
    void loadSaved();
  }, []);

  async function saveCurrent(asNew: boolean) {
    const name = screenName.trim();
    if (!name) {
      setSaveState("Name the screen first.");
      return;
    }
    setSaveState("saving…");
    try {
      const res = await fetch("/api/screener/saved", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: asNew ? undefined : (screenId ?? undefined),
          name,
          pool,
          combinator,
          criteria,
          columns,
        }),
      });
      const j = (await res.json()) as { screen?: SavedScreenSummary; error?: string };
      if (j.error) throw new Error(j.error);
      if (j.screen) setScreenId(j.screen.id);
      setSaveState("saved");
      await loadSaved();
    } catch (e) {
      setSaveState(e instanceof Error ? e.message : "save failed");
    }
  }

  function applySaved(s: SavedScreenSummary) {
    setScreenId(s.id);
    setScreenName(s.name);
    setRegions((s.pool.regions ?? ["US"]) as Region[]);
    setSectors((s.pool.sectors ?? []) as Sector[]);
    setBuckets((s.pool.buckets ?? []) as CapBucket[]);
    setMinVol(s.pool.minDollarVolume ? String(s.pool.minDollarVolume) : "");
    setMinPrice(s.pool.minPrice ? String(s.pool.minPrice) : "");
    setCombinator(s.combinator);
    setCriteria(s.criteria);
    if (s.columns?.length) setColumns(s.columns as MetricKey[]);
    setSaveState(null);
  }

  async function removeSaved(id: string) {
    await fetch(`/api/screener/saved?id=${id}`, { method: "DELETE" }).catch(() => null);
    if (screenId === id) setScreenId(null);
    await loadSaved();
  }

  async function copySaved(id: string) {
    await fetch("/api/screener/saved", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => null);
    await loadSaved();
  }

  async function run(quiet = false) {
    if (!quiet) setLoading(true);
    setRan(true);
    try {
      const res = await fetch("/api/screener", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pool, screen }),
      });
      setData(await res.json());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  // Run once on mount so the page is not an empty form.
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Enrichment runs in a background queue, so the first answer is fast but
   * partial. Poll quietly while it owes us rows: no loading state, controls
   * stay live, the table fills in underneath.
   */
  useEffect(() => {
    if (!data || data.analyzing <= 0) return;
    const t = setTimeout(() => void run(true), 4_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const rows = useMemo(() => {
    const r = data?.rows ?? [];
    if (sortKey === "symbol") return [...r].sort((a, b) => a.symbol.localeCompare(b.symbol));
    return [...r].sort((a, b) => {
      const av = a.row[sortKey];
      const bv = b.row[sortKey];
      const an = typeof av === "number" && Number.isFinite(av) ? av : -Infinity;
      const bn = typeof bv === "number" && Number.isFinite(bv) ? bv : -Infinity;
      return bn - an;
    });
  }, [data, sortKey]);

  const toggle = <T,>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const addCriterion = () =>
    setCriteria((c) => [
      ...c,
      { id: uid(), metric: "evEbitda", comparator: "lt", basis: "absolute", value: 10, value2: null, enabled: true },
    ]);

  const patch = (id: string, p: Partial<Criterion>) =>
    setCriteria((c) => c.map((x) => (x.id === id ? { ...x, ...p } : x)));

  return (
    <div className="flex flex-col gap-3">
      <Note>
        <span>
          You define the criteria; nothing is ranked for you. A company with no value for a metric
          you filter on <strong>fails that criterion</strong> — it is never admitted on a blank. A
          metric that is not meaningful for a business, such as EV/EBITDA for a bank, is skipped
          for that company rather than counted as a failure.
        </span>
      </Note>

      {/* ---------------------------------------------------------- universe */}
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Universe</h2>
          <span className="text-[10px] text-[var(--ink-3)]">applied before any metric is read</span>
        </div>
        <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Group label="Region">
            {(["US", "BIST"] as Region[]).map((r) => (
              <Toggle key={r} on={regions.includes(r)} onClick={() => setRegions(toggle(regions, r))}>
                {r}
              </Toggle>
            ))}
          </Group>
          <Group label="Market cap">
            {BUCKETS.map((b) => (
              <Toggle
                key={b}
                on={buckets.includes(b)}
                title={`US ${CAP_BUCKET_LABEL.US[b]} · BIST ${CAP_BUCKET_LABEL.BIST[b]}`}
                onClick={() => setBuckets(toggle(buckets, b))}
              >
                {b}
              </Toggle>
            ))}
          </Group>
          <Group label="Min price">
            <input
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              placeholder="e.g. 5"
              className="w-full rounded-sm border border-[var(--line)] bg-[var(--panel-2)] px-2 py-0.5 text-[11px] outline-none focus:border-[var(--amber)]"
            />
          </Group>
          <Group label="Min daily value traded">
            <input
              value={minVol}
              onChange={(e) => setMinVol(e.target.value)}
              placeholder="e.g. 1000000"
              className="w-full rounded-sm border border-[var(--line)] bg-[var(--panel-2)] px-2 py-0.5 text-[11px] outline-none focus:border-[var(--amber)]"
            />
          </Group>
        </div>
        <div className="border-t border-[var(--line)] p-3">
          <Group label="Sector">
            {SECTOR_LIST.map((s) => (
              <Toggle key={s} on={sectors.includes(s)} onClick={() => setSectors(toggle(sectors, s))}>
                {s}
              </Toggle>
            ))}
          </Group>
        </div>
      </section>

      {/* ---------------------------------------------------------- criteria */}
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Criteria</h2>
          <span className="ml-auto flex items-center gap-2">
            {(["AND", "OR"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCombinator(c)}
                className={cn(
                  "rounded-sm border px-2 py-0.5 text-[10px]",
                  combinator === c
                    ? "border-[var(--amber)] text-[var(--amber)]"
                    : "border-[var(--line)] text-[var(--ink-3)]",
                )}
              >
                {c}
              </button>
            ))}
            <button
              type="button"
              onClick={addCriterion}
              className="rounded-sm border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--ink-2)] hover:border-[var(--ink-3)]"
            >
              + ADD
            </button>
          </span>
        </div>

        {criteria.length === 0 ? (
          <div className="px-3 py-3 text-[10.5px] text-[var(--ink-3)]">
            No criteria yet — the screen returns the whole filtered universe. Add one to narrow it.
          </div>
        ) : (
          <div className="divide-y divide-[var(--line-soft)]">
            {criteria.map((c) => {
              const def = METRIC_BY_KEY.get(c.metric);
              const basis = BASES.find((b) => b.key === c.basis)!;
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    onChange={(e) => patch(c.id, { enabled: e.target.checked })}
                    className="accent-[var(--amber)]"
                  />
                  <select
                    value={c.metric}
                    onChange={(e) => patch(c.id, { metric: e.target.value as MetricKey })}
                    className="rounded-sm border border-[var(--line)] bg-[var(--panel-2)] px-1 py-0.5 text-[10.5px]"
                  >
                    {METRIC_GROUPS.map((g) => (
                      <optgroup key={g} label={g}>
                        {METRICS.filter((m) => m.group === g).map((m) => (
                          <option key={m.key} value={m.key}>
                            {m.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <select
                    value={c.comparator}
                    onChange={(e) => patch(c.id, { comparator: e.target.value as Comparator })}
                    className="rounded-sm border border-[var(--line)] bg-[var(--panel-2)] px-1 py-0.5 text-[10.5px]"
                  >
                    {COMPARATORS.map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={c.value ?? ""}
                    onChange={(e) =>
                      patch(c.id, { value: e.target.value === "" ? null : Number(e.target.value) })
                    }
                    placeholder="value"
                    className="w-[76px] rounded-sm border border-[var(--line)] bg-[var(--panel-2)] px-1 py-0.5 text-[10.5px] tabular-nums"
                  />
                  {c.comparator === "between" && (
                    <input
                      value={c.value2 ?? ""}
                      onChange={(e) =>
                        patch(c.id, { value2: e.target.value === "" ? null : Number(e.target.value) })
                      }
                      placeholder="and"
                      className="w-[76px] rounded-sm border border-[var(--line)] bg-[var(--panel-2)] px-1 py-0.5 text-[10.5px] tabular-nums"
                    />
                  )}
                  <select
                    value={c.basis}
                    onChange={(e) => patch(c.id, { basis: e.target.value as Basis })}
                    title={basis.hint}
                    className="rounded-sm border border-[var(--line)] bg-[var(--panel-2)] px-1 py-0.5 text-[10.5px]"
                  >
                    {BASES.map((b) => (
                      <option key={b.key} value={b.key}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                  {def?.unit === "pct" && c.basis === "absolute" && (
                    <span className="text-[9.5px] text-[var(--ink-3)]">%</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setCriteria((x) => x.filter((y) => y.id !== c.id))}
                    className="ml-auto text-[10px] text-[var(--ink-3)] hover:text-rose-400"
                  >
                    remove
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-[var(--line)] px-3 py-2">
          <button
            type="button"
            onClick={() => void run()}
            disabled={loading}
            className="rounded-sm border border-[var(--amber)] bg-[rgba(255,160,40,0.12)] px-3 py-1 text-[11px] font-medium text-[var(--amber)] disabled:opacity-50"
          >
            {loading ? "Screening…" : "RUN SCREEN"}
          </button>
          <span className="text-[9.5px] text-[var(--ink-3)]">
            {combinator === "AND"
              ? "Every enabled criterion must pass."
              : "At least one enabled criterion must pass."}
          </span>
        </div>
      </section>

      {/* ------------------------------------------------------ saved screens */}
      <section className="panel">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">Screen</span>
          <input
            value={screenName}
            onChange={(e) => {
              setScreenName(e.target.value);
              setSaveState(null);
            }}
            placeholder="name this screen"
            className="w-52 rounded-sm border border-[var(--line)] bg-transparent px-2 py-1 text-[10.5px] outline-none focus:border-[var(--amber)]"
          />
          <button
            type="button"
            onClick={() => void saveCurrent(false)}
            className="rounded-sm border border-[var(--amber)] px-2 py-1 text-[10px] text-[var(--amber)]"
          >
            {screenId ? "SAVE" : "SAVE NEW"}
          </button>
          {screenId && (
            <button
              type="button"
              onClick={() => void saveCurrent(true)}
              className="rounded-sm border border-[var(--line)] px-2 py-1 text-[10px] text-[var(--ink-2)]"
            >
              SAVE AS NEW
            </button>
          )}
          {saveState && <span className="text-[10px] text-[var(--ink-3)]">{saveState}</span>}
        </div>

        {saved.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--line)] px-3 py-2">
            {saved.map((s) => (
              <span
                key={s.id}
                className={cn(
                  "flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px]",
                  s.id === screenId
                    ? "border-[var(--amber)] text-[var(--amber)]"
                    : "border-[var(--line)] text-[var(--ink-2)]",
                )}
              >
                <button type="button" onClick={() => applySaved(s)} title="load">
                  {s.name}
                </button>
                <button
                  type="button"
                  onClick={() => void copySaved(s.id)}
                  className="text-[var(--ink-3)]"
                  title="duplicate"
                >
                  ⧉
                </button>
                <button
                  type="button"
                  onClick={() => void removeSaved(s.id)}
                  className="text-[var(--ink-3)]"
                  title="delete"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] leading-snug text-[var(--ink-3)]">
          Saving stores the question — universe, criteria and columns — not the matches. Opening a
          saved screen re-runs it against current data.
        </div>
      </section>

      {/* ---------------------------------------------------------- coverage */}
      <section className="panel">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">Coverage</span>
          <Stat label="Eligible" v={data?.eligible ?? 0} />
          <Stat label="Data available" v={data?.dataAvailable ?? 0} />
          <Stat label="Matches" v={data?.matches ?? 0} />
          {(data?.analyzing ?? 0) === 0 && (data?.dataAvailable ?? 0) > 0 && (
            <span className="text-[10px] text-[var(--green)]">RESULTS READY</span>
          )}
          {(data?.analyzing ?? 0) > 0 && (
            <span className="text-[10px] text-[var(--amber)]">
              ENRICHING {data!.analyzing} MORE… results update automatically
            </span>
          )}
          {data && data.dataAvailable > data.matches && (
            <span className="text-[10px] text-[var(--ink-3)]">
              rejected — {data.rejected.failed.toLocaleString()} failed a test,{" "}
              {data.rejected.noData.toLocaleString()} missing the metric,{" "}
              {data.rejected.noPeers.toLocaleString()} without a peer group
            </span>
          )}
        </div>
        <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] leading-snug text-[var(--ink-3)]">
          Enrichment is spent on this universe, most-traded first — a small-cap screen never fetches
          mega caps to fill the table. Every stock in the {data?.universe.toLocaleString() ?? 0}-name
          listing stays searchable and can enter a screen; missing metrics read N/A rather than
          removing the company from the universe.
        </div>
      </section>

      {/* ----------------------------------------------------------- results */}
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Results</h2>
          <span className="ml-auto text-[10px] text-[var(--ink-3)]">{rows.length} shown</span>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-[var(--line)] px-2 py-1.5">
          <span className="text-[9.5px] text-[var(--ink-3)]">columns</span>
          {METRICS.slice(0, 40).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setColumns((c) => toggle(c, m.key))}
              className={cn(
                "rounded-sm border px-1 py-px text-[9px]",
                columns.includes(m.key)
                  ? "border-[var(--amber)] text-[var(--amber)]"
                  : "border-[var(--line)] text-[var(--ink-3)]",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="p-4 text-center text-[11px] leading-relaxed text-[var(--ink-3)]">
            <div className="font-semibold text-[var(--ink-2)]">
              {ran ? "NO STOCKS MATCH THESE CRITERIA" : "Run a screen to see results"}
            </div>
            {ran && (
              <div className="mt-1">
                Eligible {data?.eligible ?? 0} · Data available {data?.dataAvailable ?? 0} · Matches 0.
                No substitution is made from outside the requested universe.
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl cursor-pointer" onClick={() => setSortKey("symbol")}>
                    Ticker
                  </th>
                  <th className="tl">Company</th>
                  <th className="tl">Sector / Industry</th>
                  <th>Price</th>
                  {columns.map((k) => (
                    <th
                      key={k}
                      className="cursor-pointer whitespace-nowrap"
                      onClick={() => setSortKey(k)}
                      title="Sort"
                    >
                      {METRIC_BY_KEY.get(k)?.label ?? k}
                    </th>
                  ))}
                  <th>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, pageSize).map((r) => {
                  const sym = currencySymbol(r.currency);
                  return (
                    <tr
                      key={r.symbol}
                      onClick={() => setDrawer(r)}
                      className="cursor-pointer hover:bg-[var(--panel-2)]"
                    >
                      <td className="tl font-semibold">{r.symbol}</td>
                      <td className="tl max-w-[150px] truncate text-[10px]" title={r.name}>
                        {r.name}
                      </td>
                      <td className="tl text-[10px] text-[var(--ink-3)]" title={r.industry ?? ""}>
                        {r.sector}
                      </td>
                      <td className="tabular-nums text-[10px]">
                        {r.price === null ? "N/A" : `${sym}${r.price.toFixed(2)}`}
                      </td>
                      {columns.map((k) => {
                        const def = METRIC_BY_KEY.get(k);
                        const v = r.row[k];
                        const n = typeof v === "number" && Number.isFinite(v) ? v : null;
                        return (
                          <td
                            key={k}
                            className={cn("tabular-nums", n === null && "text-[var(--ink-3)]")}
                          >
                            {formatMetric(n, def?.unit ?? "num", sym)}
                          </td>
                        );
                      })}
                      <td className="tabular-nums text-[9.5px] text-[var(--ink-3)]">
                        {r.coverage.have}/{r.coverage.total}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > pageSize && (
              <div className="flex items-center gap-3 border-t border-[var(--line)] px-3 py-2">
                <button
                  type="button"
                  onClick={() => setPageSize((n) => n + 60)}
                  className="rounded-sm border border-[var(--line)] px-2 py-1 text-[10px] text-[var(--ink-2)]"
                >
                  SHOW 60 MORE
                </button>
                <span className="text-[9.5px] text-[var(--ink-3)]">
                  showing {pageSize} of {rows.length} matches — sorting applies to all {rows.length}
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      {drawer && <Drawer row={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}

function Stat({ label, v }: { label: string; v: number }) {
  return (
    <span className="text-[10.5px] text-[var(--ink-2)]">
      {label} <span className="tabular-nums font-semibold">{v}</span>
    </span>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[9.5px] uppercase tracking-wide text-[var(--ink-3)]">{label}</div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Toggle({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "rounded-sm border px-1.5 py-0.5 text-[9.5px]",
        on
          ? "border-[var(--amber)] bg-[rgba(255,160,40,0.12)] text-[var(--amber)]"
          : "border-[var(--line)] text-[var(--ink-3)] hover:border-[var(--ink-3)]",
      )}
    >
      {children}
    </button>
  );
}

/** Compact detail without leaving the screen. */
function Drawer({ row, onClose }: { row: ScreenRowOut; onClose: () => void }) {
  const sym = currencySymbol(row.currency);
  const show = (keys: MetricKey[]) =>
    keys.map((k) => {
      const def = METRIC_BY_KEY.get(k);
      const v = row.row[k];
      const n = typeof v === "number" && Number.isFinite(v) ? v : null;
      return (
        <div key={k} className="flex justify-between px-3 py-0.5 text-[10.5px]">
          <span className="text-[var(--ink-3)]">{def?.label ?? k}</span>
          <span className="tabular-nums">{formatMetric(n, def?.unit ?? "num", sym)}</span>
        </div>
      );
    });

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-[420px] overflow-y-auto border-l border-[var(--line)] bg-[var(--panel)] shadow-2xl">
      <div className="sticky top-0 flex items-center gap-2 border-b border-[var(--line)] bg-[var(--panel)] px-3 py-2">
        <span className="text-[13px] font-semibold">{row.symbol}</span>
        <span className="truncate text-[10px] text-[var(--ink-3)]">{row.name}</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-sm border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--ink-3)]"
        >
          close
        </button>
      </div>

      <div className="border-b border-[var(--line)] px-3 py-2 text-[10px] text-[var(--ink-3)]">
        {row.sector}
        {row.industry ? ` · ${row.industry}` : ""} · {row.bucket ?? "SIZE UNKNOWN"}
      </div>

      <Section title="Why it matched">
        {row.results.length === 0 ? (
          <div className="px-3 py-0.5 text-[10.5px] text-[var(--ink-3)]">No criteria set.</div>
        ) : (
          row.results.map((r) => {
            const def = METRIC_BY_KEY.get(r.criterion.metric as MetricKey);
            const unit = def?.unit ?? "num";
            const pctBasis =
              r.criterion.basis === "sectorPercentile" ||
              r.criterion.basis === "industryPercentile";
            return (
              <div key={r.criterion.id} className="px-3 py-0.5 text-[10.5px]">
                <div className="flex justify-between gap-2">
                  <span className="text-[var(--ink-3)]">{def?.label ?? r.criterion.metric}</span>
                  <span
                    className={
                      r.outcome === "PASS"
                        ? "text-[var(--green)]"
                        : r.outcome === "NOT_APPLICABLE"
                          ? "text-[var(--ink-3)]"
                          : "text-[var(--amber)]"
                    }
                  >
                    {r.outcome === "NOT_APPLICABLE"
                      ? "n/a for this sector"
                      : r.outcome === "NO_PEERS"
                        ? "no peer group"
                        : r.outcome === "NO_DATA"
                          ? "not reported"
                          : r.outcome.toLowerCase()}
                  </span>
                </div>
                {r.value !== null && (
                  <div className="flex justify-between gap-2 text-[9.5px] text-[var(--ink-3)]">
                    <span className="tabular-nums">
                      {pctBasis
                        ? `${r.value.toFixed(0)}th pct`
                        : formatMetric(r.value, unit, sym)}
                    </span>
                    {r.threshold !== null && (
                      <span className="tabular-nums">
                        vs {pctBasis ? `${r.threshold.toFixed(0)}th` : formatMetric(r.threshold, unit, sym)}
                        {r.criterion.basis === "sectorMedian"
                          ? " sector median"
                          : r.criterion.basis === "industryMedian"
                            ? " industry median"
                            : ""}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </Section>

      <Section title="Valuation">{show(["marketCap", "enterpriseValue", "pe", "forwardPe", "evEbitda", "ps", "pb", "fcfYield"])}</Section>
      <Section title="Growth">{show(["revenueGrowth", "epsGrowth", "fcfGrowth", "operatingIncomeGrowth"])}</Section>
      <Section title="Profitability">{show(["grossMargin", "operatingMargin", "netMargin", "roe", "roic"])}</Section>
      <Section title="Balance sheet">{show(["cash", "netDebt", "netDebtToEbitda", "currentRatio", "equityToAssets"])}</Section>
      <Section title="Technical">{show(["return12m", "relativeStrength", "rsi", "from200dma", "volatility"])}</Section>

      <div className="flex flex-wrap gap-2 border-t border-[var(--line)] px-3 py-3">
        <Link
          href={`/ticker/${row.symbol}`}
          className="rounded-sm border border-[var(--amber)] px-2 py-1 text-[10px] text-[var(--amber)]"
        >
          OPEN FULL RESEARCH
        </Link>
        <Link
          href={`/compare?symbols=${row.symbol}`}
          className="rounded-sm border border-[var(--line)] px-2 py-1 text-[10px] text-[var(--ink-2)]"
        >
          COMPARE
        </Link>
        <Link
          href="/watchlist"
          className="rounded-sm border border-[var(--line)] px-2 py-1 text-[10px] text-[var(--ink-2)]"
        >
          WATCHLIST
        </Link>
      </div>
      <p className="px-3 pb-4 text-[9px] leading-snug text-[var(--ink-3)]">
        Opportunity score and model fair value live on the full research page — they need the peer
        engine, which is not run for every screener row.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--line)] py-1.5">
      <div className="px-3 pb-1 text-[9.5px] uppercase tracking-wide text-[var(--ink-3)]">
        {title}
      </div>
      {children}
    </div>
  );
}
