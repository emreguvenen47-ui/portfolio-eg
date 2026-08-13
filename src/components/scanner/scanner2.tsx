"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Chip, Note } from "@/components/shell/ui";
import { cn } from "@/lib/utils";
import { currencySymbol } from "@/lib/format-currency";
import { compactMoney } from "@/components/research/primitives";
import { EMPTY_FILTERS, PRESETS, applyFilters, applyPreset, type ScanFilters } from "@/lib/scanner/filters";
import { SECTOR_LIST } from "@/lib/scanner/score";
import { CAP_BUCKET_LABEL, type CapBucket, type Region } from "@/lib/scanner/types";
import type { ScanRow } from "@/lib/scanner/engine";
import type { Pillar } from "@/lib/scanner/metrics";

const BUCKETS: CapBucket[] = ["MICRO", "SMALL", "MID", "LARGE", "MEGA"];
const PILLARS: Pillar[] = [
  "quality",
  "growth",
  "valuation",
  "profitability",
  "balanceSheet",
  "momentum",
  "sentiment",
  "risk",
];
const PILLAR_LABEL: Record<Pillar, string> = {
  quality: "Quality",
  growth: "Growth",
  valuation: "Valuation",
  profitability: "Profit",
  balanceSheet: "Balance",
  momentum: "Momentum",
  sentiment: "Sentiment",
  risk: "Risk",
};

type SortKey = "score" | "upside" | "valuation" | "growth" | "quality" | "momentum" | "marketCap";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "score", label: "Score" },
  { key: "upside", label: "Upside" },
  { key: "valuation", label: "Valuation" },
  { key: "growth", label: "Growth" },
  { key: "quality", label: "Quality" },
  { key: "momentum", label: "Momentum" },
  { key: "marketCap", label: "Market cap" },
];

/** Sorting reorders the filtered set; it never changes what is in it. */
function sortRows(rows: ScanRow[], key: SortKey): ScanRow[] {
  const pillar = (r: ScanRow, p: Pillar) =>
    r.result.pillars.find((x) => x.pillar === p)?.score ?? -1;
  const value = (r: ScanRow): number => {
    switch (key) {
      case "upside":
        return r.fair.upsideLow ?? -Infinity;
      case "valuation":
        return pillar(r, "valuation");
      case "growth":
        return pillar(r, "growth");
      case "quality":
        return pillar(r, "quality");
      case "momentum":
        return pillar(r, "momentum");
      case "marketCap":
        return r.marketCap ?? -1;
      default:
        return r.result.score ?? -1;
    }
  };
  return [...rows].sort((a, b) => value(b) - value(a));
}

/** Human description of the requested universe, for the coverage header. */
function describeUniverse(f: ScanFilters): string {
  const size = f.buckets.length ? f.buckets.join("/") : "All sizes";
  const sector = f.sectors.length ? f.sectors.join(", ") : "All sectors";
  const region = f.regions.length ? f.regions.join("+") : "All regions";
  return `${size} · ${sector} · ${region}`;
}

const scoreTone = (s: number | null) =>
  s === null ? "text-[var(--ink-3)]" : s >= 70 ? "text-emerald-400" : s <= 35 ? "text-rose-400" : "";

export function Scanner2() {
  const [data, setData] = useState<{
    rows: ScanRow[];
    eligible: number;
    analyzed: number;
    rankable: number;
    warming: number;
    universe: number;
    coverage: { assembled: number; tradable: number };
  } | null>(null);
  const [sort, setSort] = useState<SortKey>("score");
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<ScanFilters>(EMPTY_FILTERS);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  /** Bumped by the poll below; a change re-runs the fetch effect. */
  const [refresh, setRefresh] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  /**
   * Pool filters go to the server, which builds the candidate set from them
   * before any scoring. Only the score-based floors are applied on the client,
   * because those operate on results that already satisfy the hard filters.
   */
  const pool = useMemo(
    () =>
      JSON.stringify({
        regions: filters.regions,
        sectors: filters.sectors,
        industries: [],
        buckets: filters.buckets,
        minMarketCap: filters.minMarketCap,
        maxMarketCap: filters.maxMarketCap,
        minDollarVolume: filters.minDollarVolume,
        minPrice: filters.minPrice,
      }),
    [
      filters.regions,
      filters.sectors,
      filters.buckets,
      filters.minMarketCap,
      filters.maxMarketCap,
      filters.minDollarVolume,
      filters.minPrice,
    ],
  );

  useEffect(() => {
    // Abort the in-flight scan when the filters change. Without this the
    // superseded request keeps running and its rejection surfaces as an
    // unhandled promise on unmount.
    const ctl = new AbortController();
    // A poll refreshes in place; only a filter change is worth a loading state.
    if (refresh === 0) setLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/scanner2", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: pool,
          signal: ctl.signal,
        });
        setData(await res.json());
      } catch (e) {
        // An abort is the expected outcome of changing filters mid-scan.
        if ((e as Error)?.name !== "AbortError") setData(null);
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctl.abort();
  }, [pool, refresh]);

  /**
   * Enrichment happens in a background queue now, so the first response is
   * fast but partial. Poll while it owes us candidates — quietly, without the
   * loading state, so the table stays readable and the controls stay live.
   */
  useEffect(() => {
    if (!data || data.warming <= 0) return;
    const t = setTimeout(() => setRefresh((n) => n + 1), 4_000);
    return () => clearTimeout(t);
  }, [data]);

  // A new filter set starts a new page count.
  useEffect(() => {
    setPageSize(50);
  }, [pool]);

  const rows = useMemo(() => {
    if (!data) return [];
    const scored = applyFilters(data.rows, filters).filter((r) => r.result.score !== null);
    return sortRows(scored, sort);
  }, [data, filters, sort]);

  const set = <K extends keyof ScanFilters>(k: K, v: ScanFilters[K]) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setActivePreset(null);
  };

  const toggle = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  if (loading) {
    return <div className="p-4 text-[11px] text-[var(--ink-3)]">Scanning…</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      <Note>
        <span>
          Every ranking is a <strong>percentile against sector peers</strong>, never an absolute
          threshold — a 22× P/E is expensive for a utility and cheap for software. Metrics that do
          not apply to a business are excluded, not scored zero, so banks are never marked down for
          having no gross margin. Not investment advice.
        </span>
      </Note>

      {/* ---------------------------------------------------------- presets */}
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Presets</h2>
          <span className="text-[10px] text-[var(--ink-3)]">
            saved filter configurations, not separate scoring engines
          </span>
        </div>
        <div className="flex flex-wrap gap-1 p-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              title={p.description}
              onClick={() => {
                setFilters((f) => applyPreset(f, p));
                setActivePreset(p.id);
              }}
              className={cn(
                "rounded-sm border px-2 py-0.5 text-[10px]",
                activePreset === p.id
                  ? "border-[var(--amber)] bg-[rgba(255,160,40,0.12)] text-[var(--amber)]"
                  : "border-[var(--line)] text-[var(--ink-3)] hover:border-[var(--ink-3)]",
              )}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setActivePreset(null);
            }}
            className="rounded-sm border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--ink-3)]"
          >
            RESET
          </button>
        </div>
        {activePreset && (
          <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
            {PRESETS.find((p) => p.id === activePreset)?.description}
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------- filters */}
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Filters</h2>
          <span className="ml-auto flex flex-wrap items-center gap-1">
            <span className="text-[9.5px] text-[var(--ink-3)]">sort</span>
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSort(s.key)}
                className={cn(
                  "rounded-sm border px-1.5 py-0.5 text-[9.5px]",
                  sort === s.key
                    ? "border-[var(--amber)] text-[var(--amber)]"
                    : "border-[var(--line)] text-[var(--ink-3)]",
                )}
              >
                {s.label}
              </button>
            ))}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Group label="Region">
            {(["US", "BIST"] as Region[]).map((r) => (
              <Toggle key={r} on={filters.regions.includes(r)} onClick={() => set("regions", toggle(filters.regions, r))}>
                {r}
              </Toggle>
            ))}
          </Group>

          <Group label="Market cap">
            {BUCKETS.map((b) => (
              <Toggle
                key={b}
                on={filters.buckets.includes(b)}
                title={`${CAP_BUCKET_LABEL.US[b]} · BIST ${CAP_BUCKET_LABEL.BIST[b]}`}
                onClick={() => set("buckets", toggle(filters.buckets, b))}
              >
                {b}
              </Toggle>
            ))}
          </Group>

          <Group label="Min coverage">
            {[0.3, 0.5, 0.7, 0.85].map((c) => (
              <Toggle key={c} on={filters.minCoverage === c} onClick={() => set("minCoverage", c)}>
                {(c * 100).toFixed(0)}%
              </Toggle>
            ))}
          </Group>

          <Group label="Min peers">
            {[3, 5, 8, 12].map((n) => (
              <Toggle key={n} on={filters.minPeers === n} onClick={() => set("minPeers", n)}>
                {n}
              </Toggle>
            ))}
          </Group>
        </div>

        <div className="grid grid-cols-1 gap-2 border-t border-[var(--line)] p-3 sm:grid-cols-2">
          <Group label="Sector">
            {SECTOR_LIST.map((s) => (
              <Toggle key={s} on={filters.sectors.includes(s)} onClick={() => set("sectors", toggle(filters.sectors, s))}>
                {s}
              </Toggle>
            ))}
          </Group>
          <Group label="Search">
            <input
              value={filters.search}
              onChange={(e) => set("search", e.target.value)}
              placeholder="ticker or name"
              className="w-full rounded-sm border border-[var(--line)] bg-[var(--panel-2)] px-2 py-0.5 text-[11px] outline-none focus:border-[var(--amber)]"
            />
          </Group>
        </div>

        <div className="border-t border-[var(--line)] p-3">
          <div className="mb-1 text-[9.5px] uppercase tracking-wide text-[var(--ink-3)]">
            Minimum pillar percentile
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
            {PILLARS.map((p) => (
              <label key={p} className="flex items-center gap-2 text-[10px]">
                <span className="w-[62px] shrink-0 text-[var(--ink-3)]">{PILLAR_LABEL[p]}</span>
                <input
                  type="range"
                  min={0}
                  max={90}
                  step={5}
                  value={filters.pillarFloors[p] ?? 0}
                  onChange={(e) =>
                    set("pillarFloors", { ...filters.pillarFloors, [p]: Number(e.target.value) })
                  }
                  className="h-1 flex-1 accent-[var(--amber)]"
                />
                <span className="w-6 shrink-0 text-right tabular-nums">
                  {filters.pillarFloors[p] ?? 0}
                </span>
              </label>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- coverage */}
      <section className="panel">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
            Current universe
          </span>
          <span className="text-[11px] font-semibold">{describeUniverse(filters)}</span>
          <span className="text-[10.5px] text-[var(--ink-2)]">
            Eligible <span className="tabular-nums font-semibold">{data?.eligible ?? 0}</span>
          </span>
          <span className="text-[10.5px] text-[var(--ink-2)]">
            Analyzed <span className="tabular-nums font-semibold">{data?.analyzed ?? 0}</span>
          </span>
          <span className="text-[10.5px] text-[var(--ink-2)]">
            Rankable <span className="tabular-nums font-semibold">{data?.rankable ?? 0}</span>
          </span>
          {(data?.warming ?? 0) === 0 && (data?.analyzed ?? 0) > 0 && (
            <span className="text-[10px] text-[var(--green)]">RESULTS READY</span>
          )}
          {data && data.coverage.tradable > 0 && (
            <span className="text-[10px] text-[var(--ink-3)]">
              listing assembled {data.coverage.assembled.toLocaleString()} /{" "}
              {data.coverage.tradable.toLocaleString()} — kept on disk, continues in the background
            </span>
          )}
          {(data?.warming ?? 0) > 0 && (
            <span className="text-[10px] text-[var(--amber)]">
              ENRICHING {data!.warming} MORE… results update automatically
            </span>
          )}
        </div>
        <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] leading-snug text-[var(--ink-3)]">
          Filters are applied before scoring, so a result outside the requested universe is not
          possible. Coverage limits how many names can be ranked; it never widens the universe to
          fill the list.
        </div>
      </section>

      {/* ---------------------------------------------------------- results */}
      <section className="panel">
        {rows.length === 0 ? (
          <div className="p-4 text-center text-[11px] leading-relaxed text-[var(--ink-3)]">
            <div className="font-semibold text-[var(--ink-2)]">
              NO RANKABLE CANDIDATES FOR CURRENT FILTERS
            </div>
            <div className="mt-1">
              Eligible {data?.eligible ?? 0} · Analyzed {data?.analyzed ?? 0} · Rankable 0
            </div>
            <div className="mt-1">
              {(data?.eligible ?? 0) === 0
                ? "No listed company matches the hard filters. Widen the size, sector or liquidity constraint."
                : (data?.analyzed ?? 0) === 0
                  ? "Companies match, but none has fundamentals assembled yet. Reload in a moment — the queue is fetching this universe, not a generic one."
                  : "Companies were analyzed but none cleared the pillar floors or the coverage requirement. Lower a floor rather than widening the universe."}
            </div>
            <div className="mt-2 text-[9.5px]">
              No substitution is made from outside the requested universe.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Symbol</th>
                  <th className="tl">Company</th>
                  <th className="tl">Sector / Industry</th>
                  <th>Market Cap</th>
                  <th>Size</th>
                  <th>Score</th>
                  {PILLARS.map((p) => (
                    <th key={p} title={PILLAR_LABEL[p]}>
                      {PILLAR_LABEL[p].slice(0, 4)}
                    </th>
                  ))}
                  <th>Fair Value</th>
                  <th>Upside</th>
                  <th className="tl">Peers</th>
                  <th className="tl">Conf.</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, pageSize).map((r) => {
                  const sym = currencySymbol(r.currency);
                  const isOpen = open === r.symbol;
                  return (
                    <>
                      <tr
                        key={r.symbol}
                        onClick={() => setOpen(isOpen ? null : r.symbol)}
                        className="cursor-pointer hover:bg-[var(--panel-2)]"
                      >
                        <td className="tl font-semibold">
                          <Link href={`/ticker/${r.symbol}`} className="hover:text-[var(--amber)]">
                            {r.symbol}
                          </Link>
                          {r.region === "BIST" && (
                            <span className="ml-1 text-[8.5px] text-[var(--amber)]">BIST</span>
                          )}
                        </td>
                        <td className="tl max-w-[160px] truncate text-[10px]" title={r.name}>
                          {r.name}
                        </td>
                        <td className="tl text-[10px] text-[var(--ink-3)]" title={r.industry ?? ""}>
                          {r.sector}
                          {r.industry && (
                            <span className="block truncate text-[9px] opacity-70">{r.industry}</span>
                          )}
                        </td>
                        <td className="tabular-nums text-[10px]">
                          {r.marketCap === null ? "N/A" : compactMoney(r.marketCap, sym)}
                        </td>
                        <td
                          className={cn(
                            "text-[9.5px]",
                            r.bucket ? "text-[var(--ink-2)]" : "text-[var(--ink-3)]",
                          )}
                        >
                          {r.bucket ?? "UNKNOWN"}
                        </td>
                        <td className={cn("tabular-nums font-semibold", scoreTone(r.result.score))}>
                          {r.result.score}
                        </td>
                        {PILLARS.map((p) => {
                          const s = r.result.pillars.find((x) => x.pillar === p)?.score ?? null;
                          return (
                            <td key={p} className={cn("tabular-nums", scoreTone(s))}>
                              {s ?? "—"}
                            </td>
                          );
                        })}
                        <td className="tabular-nums text-[10px]">
                          {r.fair.available && r.fair.low !== null && r.fair.high !== null
                            ? `${compactMoney(r.fair.low, sym)}–${compactMoney(r.fair.high, sym)}`
                            : "N/A"}
                        </td>
                        <td
                          className={cn(
                            "tabular-nums",
                            (r.fair.upsideLow ?? 0) > 0 ? "text-emerald-400" : "text-rose-400",
                          )}
                        >
                          {r.fair.upsideLow === null
                            ? "N/A"
                            : `${r.fair.upsideLow > 0 ? "+" : ""}${r.fair.upsideLow.toFixed(0)}%`}
                        </td>
                        <td className="tl text-[9.5px] text-[var(--ink-3)]">
                          {r.result.peer.basis === "industry" ? "ind" : "sec"} {r.result.peer.n}
                        </td>
                        <td className="tl">
                          <Chip
                            tone={
                              r.result.confidence === "HIGH"
                                ? "pos"
                                : r.result.confidence === "LOW"
                                  ? "warn"
                                  : "neutral"
                            }
                          >
                            {r.result.confidence}
                          </Chip>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${r.symbol}-d`}>
                          <td colSpan={PILLARS.length + 10} className="tl bg-[var(--panel-2)] p-0">
                            <Detail row={r} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
            {rows.length > pageSize && (
              <div className="flex items-center gap-3 border-t border-[var(--line)] px-3 py-2">
                <button
                  type="button"
                  onClick={() => setPageSize((n) => n + 50)}
                  className="rounded-sm border border-[var(--line)] px-2 py-1 text-[10px] text-[var(--ink-2)]"
                >
                  SHOW 50 MORE
                </button>
                <span className="text-[9.5px] text-[var(--ink-3)]">
                  showing {pageSize} of {rows.length} ranked — sorting and filtering apply to all{" "}
                  {rows.length}
                </span>
              </div>
            )}
          </div>
        )}
        <div className="border-t border-[var(--line)] px-3 py-2 text-[9.5px] leading-snug text-[var(--ink-3)]">
          Every row above satisfies the hard filters — size, sector and region are applied to the
          full listing before anything is scored. Fundamentals are fetched for this universe
          specifically, not for whichever companies happen to be popular. Click a row for the
          reasoning behind its score.
        </div>
      </section>
    </div>
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

function Detail({ row }: { row: ScanRow }) {
  const sym = currencySymbol(row.currency);
  return (
    <div className="grid grid-cols-1 divide-y divide-[var(--line)] lg:grid-cols-3 lg:divide-x lg:divide-y-0">
      <div className="px-3 py-2">
        <div className="mb-1 text-[9.5px] uppercase tracking-wide text-emerald-400">
          Why we like it
        </div>
        {row.explanation.likes.length === 0 ? (
          <p className="text-[10px] text-[var(--ink-3)]">Nothing stands out against peers.</p>
        ) : (
          <ul className="list-disc space-y-0.5 pl-4">
            {row.explanation.likes.map((l, i) => (
              <li key={i} className="text-[10px] leading-snug">{l}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="px-3 py-2">
        <div className="mb-1 text-[9.5px] uppercase tracking-wide text-rose-400">
          What we don&apos;t like
        </div>
        {row.explanation.dislikes.length === 0 ? (
          <p className="text-[10px] text-[var(--ink-3)]">Nothing ranks badly against peers.</p>
        ) : (
          <ul className="list-disc space-y-0.5 pl-4">
            {row.explanation.dislikes.map((l, i) => (
              <li key={i} className="text-[10px] leading-snug">{l}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="px-3 py-2">
        <div className="mb-1 text-[9.5px] uppercase tracking-wide text-[var(--ink-3)]">
          Model fair value
        </div>
        {!row.fair.available ? (
          <p className="text-[10px] text-[var(--ink-3)]">{row.fair.note}</p>
        ) : (
          <>
            <table className="w-full text-[10px]">
              <tbody>
                {row.fair.methods.map((m) => (
                  <tr key={m.method}>
                    <td className="text-[var(--ink-3)]">{m.label}</td>
                    <td className="tabular-nums">
                      {m.current.toFixed(1)}× vs {m.peerMedian.toFixed(1)}×
                    </td>
                    <td className="text-right tabular-nums">{compactMoney(m.impliedPrice, sym)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[10px]">
              Range{" "}
              <span className="font-semibold">
                {compactMoney(row.fair.low, sym)}–{compactMoney(row.fair.high, sym)}
              </span>{" "}
              · confidence {row.fair.confidence}
            </p>
            <p className="mt-1 text-[9px] leading-snug text-[var(--ink-3)]">{row.fair.note}</p>
          </>
        )}
        <div className="mt-2 text-[9.5px] uppercase tracking-wide text-[var(--ink-3)]">
          What would change the view
        </div>
        <ul className="list-disc space-y-0.5 pl-4">
          {row.explanation.triggers.map((t, i) => (
            <li key={i} className="text-[9.5px] leading-snug text-[var(--ink-3)]">{t}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
