"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * UNIVERSE SCREENER — dense professional filter terminal over the ONE
 * precomputed canonical table (~7k US companies). Every filter change is an
 * in-memory query on the server (measured 1–4ms); no provider is ever called
 * from here. Results are instant and honest: N/A rows fail numeric filters.
 */

interface Row {
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  price: number | null;
  peTtm: number | null;
  forwardPe: number | null;
  priceToBook: number | null;
  evToEbitda: number | null;
  fcfYield: number | null;
  roe: number | null;
  revenueGrowthYoY: number | null;
  epsGrowthYoY: number | null;
  netMarginTtm: number | null;
  netDebtToEbitda: number | null;
  fairValue: number | null;
  upsidePct: number | null;
  valuationConfidence: string | null;
  revisionScore: number | null;
  expectationGapPct: number | null;
  technicalScore: number | null;
  technicalSignal: string | null;
  setupType: string | null;
  signalFreshness: string | null;
  weeklyRegime: string | null;
  riskReward: number | null;
  distanceToSupportPct: number | null;
  egSetupScore: number | null;
}

interface ApiResult {
  rows: Row[];
  total: number;
  coverage: { rows: number; newest: string | null };
  queryMs: number;
}

const SECTORS = [
  "Technology",
  "Healthcare",
  "Financial Services",
  "Consumer Cyclical",
  "Consumer Defensive",
  "Industrials",
  "Energy",
  "Utilities",
  "Real Estate",
  "Basic Materials",
  "Communication Services",
];

const SIGNALS = [
  "STRONG_BUY",
  "BUY",
  "BREAKOUT_BUY",
  "BUY_ON_RETEST",
  "TACTICAL_BUY",
  "WATCHING_FOR_ENTRY",
  "BREAKOUT_PENDING",
  "RETEST_REQUIRED",
  "WAIT",
  "REDUCE",
  "SELL",
];

const SETUPS = [
  "SUPPORT_BOUNCE",
  "BREAKOUT",
  "BREAKOUT_RETEST",
  "TREND_CONTINUATION",
  "MA50_RETEST",
  "MAJOR_SUPPORT_REVERSAL",
  "OVERSOLD_RECOVERY",
];

const REGIMES = ["UPTREND", "DOWNTREND", "RANGE", "RECOVERY", "BREAKDOWN"];

const MCAP_PRESETS: Array<[string, number | undefined, number | undefined]> = [
  ["Any size", undefined, undefined],
  ["Mega > $100B", 100e9, undefined],
  ["Large $10–100B", 10e9, 100e9],
  ["Mid $2–10B", 2e9, 10e9],
  ["Small $250M–2B", 250e6, 2e9],
];

interface Filters {
  text: string;
  mcapIdx: number;
  sectors: string[];
  maxPe: string;
  maxForwardPe: string;
  maxPb: string;
  maxEvEbitda: string;
  minRevenueGrowth: string; // %
  minEpsGrowth: string; // %
  minNetMargin: string; // %
  minFcfYield: string; // %
  minRoe: string; // %
  minUpsidePct: string;
  minRevisionScore: string;
  minExpectationGap: string;
  minTechnicalScore: string;
  signals: string[];
  setups: string[];
  weeklyRegimes: string[];
  minRiskReward: string;
  maxDistanceToSupportPct: string;
  valuationConfidence: string[];
}

const EMPTY: Filters = {
  text: "",
  mcapIdx: 0,
  sectors: [],
  maxPe: "",
  maxForwardPe: "",
  maxPb: "",
  maxEvEbitda: "",
  minRevenueGrowth: "",
  minEpsGrowth: "",
  minNetMargin: "",
  minFcfYield: "",
  minRoe: "",
  minUpsidePct: "",
  minRevisionScore: "",
  minExpectationGap: "",
  minTechnicalScore: "",
  signals: [],
  setups: [],
  weeklyRegimes: [],
  minRiskReward: "",
  maxDistanceToSupportPct: "",
  valuationConfidence: [],
};

const numOr = (s: string): number | undefined => {
  const v = Number(s);
  return s.trim() !== "" && Number.isFinite(v) ? v : undefined;
};
const fracOr = (s: string): number | undefined => {
  const v = numOr(s);
  return v === undefined ? undefined : v / 100;
};

function buildQuery(f: Filters, sortBy: string, sortDir: "asc" | "desc") {
  const [, minMarketCap, maxMarketCap] = MCAP_PRESETS[f.mcapIdx] ?? MCAP_PRESETS[0]!;
  return {
    text: f.text.trim() || undefined,
    minMarketCap,
    maxMarketCap,
    sectors: f.sectors.length ? f.sectors : undefined,
    maxPe: numOr(f.maxPe),
    maxForwardPe: numOr(f.maxForwardPe),
    maxPb: numOr(f.maxPb),
    maxEvEbitda: numOr(f.maxEvEbitda),
    minRevenueGrowth: fracOr(f.minRevenueGrowth),
    minEpsGrowth: fracOr(f.minEpsGrowth),
    minNetMargin: fracOr(f.minNetMargin),
    minFcfYield: fracOr(f.minFcfYield),
    minRoe: fracOr(f.minRoe),
    minUpsidePct: numOr(f.minUpsidePct),
    minRevisionScore: numOr(f.minRevisionScore),
    minExpectationGap: numOr(f.minExpectationGap),
    minTechnicalScore: numOr(f.minTechnicalScore),
    signals: f.signals.length ? f.signals : undefined,
    setups: f.setups.length ? f.setups : undefined,
    weeklyRegimes: f.weeklyRegimes.length ? f.weeklyRegimes : undefined,
    minRiskReward: numOr(f.minRiskReward),
    maxDistanceToSupportPct: numOr(f.maxDistanceToSupportPct),
    valuationConfidence: f.valuationConfidence.length ? f.valuationConfidence : undefined,
    sortBy,
    sortDir,
    limit: 200,
  };
}

const fmtMcap = (v: number | null) =>
  v === null ? "—" : v >= 1e12 ? `${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : `${(v / 1e6).toFixed(0)}M`;
const n1 = (v: number | null, d = 1) => (v === null ? "—" : v.toFixed(d));
const pctP = (v: number | null, d = 0) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const pctF = (v: number | null, d = 0) => (v === null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);

const COLS: Array<{ key: string; label: string; render: (r: Row) => string; cls?: (r: Row) => string }> = [
  { key: "marketCap", label: "Mcap", render: (r) => fmtMcap(r.marketCap) },
  { key: "price", label: "Price", render: (r) => n1(r.price, 2) },
  { key: "peTtm", label: "P/E", render: (r) => n1(r.peTtm) },
  { key: "forwardPe", label: "FwdPE", render: (r) => n1(r.forwardPe) },
  { key: "priceToBook", label: "P/B", render: (r) => n1(r.priceToBook) },
  { key: "evToEbitda", label: "EV/EBITDA", render: (r) => n1(r.evToEbitda) },
  { key: "revenueGrowthYoY", label: "Rev g", render: (r) => pctF(r.revenueGrowthYoY), cls: (r) => ((r.revenueGrowthYoY ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400") },
  { key: "netMarginTtm", label: "Net m", render: (r) => pctF(r.netMarginTtm) },
  { key: "fcfYield", label: "FCF y", render: (r) => pctF(r.fcfYield, 1) },
  { key: "roe", label: "ROE", render: (r) => pctF(r.roe) },
  { key: "upsidePct", label: "Upside", render: (r) => pctP(r.upsidePct), cls: (r) => ((r.upsidePct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400") },
  { key: "revisionScore", label: "Rev sc", render: (r) => (r.revisionScore === null ? "—" : String(r.revisionScore)) },
  { key: "technicalScore", label: "Tech", render: (r) => (r.technicalScore === null ? "—" : String(r.technicalScore)) },
  { key: "riskReward", label: "R:R", render: (r) => n1(r.riskReward) },
  { key: "egSetupScore", label: "Score", render: (r) => (r.egSetupScore === null ? "—" : String(r.egSetupScore)) },
];

function MultiChip({
  options,
  value,
  onChange,
  compactLabels,
}: {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  compactLabels?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wide transition-colors ${
              on
                ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-300"
                : "border-[var(--line)] text-[var(--ink-3)] hover:text-[var(--ink-1,inherit)]"
            }`}
          >
            {compactLabels ? o.replaceAll("_", " ") : o}
          </button>
        );
      })}
    </div>
  );
}

function Num({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
}) {
  return (
    <label className="flex items-center gap-1 text-[9.5px] text-[var(--ink-3)]">
      <span className="w-24 shrink-0 uppercase tracking-wide">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-16 rounded border border-[var(--line)] bg-transparent px-1 py-0.5 text-[10.5px] tabular-nums text-[var(--ink-1,inherit)] outline-none focus:border-cyan-500/60"
      />
      {suffix ? <span>{suffix}</span> : null}
    </label>
  );
}

/** Map an API UniverseQuery back onto the visible filter inputs, so the user
 * SEES how the sentence was interpreted and can correct it by hand. */
function applyNl(_prev: Filters, q: Record<string, unknown>): Partial<Filters> {
  const s = (v: unknown, frac = false): string =>
    typeof v === "number" ? String(frac ? v * 100 : v) : "";
  const mcapIdx =
    q.minMarketCap === 100e9 ? 1 : q.minMarketCap === 10e9 ? 2 : q.maxMarketCap === 2e9 ? 4 : q.minMarketCap === 2e9 ? 3 : 0;
  return {
    mcapIdx,
    sectors: Array.isArray(q.sectors) ? (q.sectors as string[]) : [],
    maxPe: s(q.maxPe),
    maxForwardPe: s(q.maxForwardPe),
    maxPb: s(q.maxPb),
    maxEvEbitda: s(q.maxEvEbitda),
    minRevenueGrowth: s(q.minRevenueGrowth, true),
    minEpsGrowth: s(q.minEpsGrowth, true),
    minNetMargin: s(q.minNetMargin, true),
    minFcfYield: s(q.minFcfYield, true),
    minRoe: s(q.minRoe, true),
    minUpsidePct: s(q.minUpsidePct),
    minRevisionScore: s(q.minRevisionScore),
    minExpectationGap: s(q.minExpectationGap),
    minTechnicalScore: s(q.minTechnicalScore),
    signals: Array.isArray(q.signals) ? (q.signals as string[]) : [],
    setups: Array.isArray(q.setups) ? (q.setups as string[]) : [],
    weeklyRegimes: Array.isArray(q.weeklyRegimes) ? (q.weeklyRegimes as string[]) : [],
    minRiskReward: s(q.minRiskReward),
    maxDistanceToSupportPct: s(q.maxDistanceToSupportPct),
    valuationConfidence: Array.isArray(q.valuationConfidence) ? (q.valuationConfidence as string[]) : [],
  };
}

function NlBox({ onResult }: { onResult: (q: Record<string, unknown>, why: string[]) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/screener/nl", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = await r.json();
      if (!j.interpretation?.length) setErr(j.answer ?? "Could not parse that sentence.");
      else onResult(j.query as Record<string, unknown>, j.interpretation as string[]);
    } catch {
      setErr("Request failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2 rounded border border-[var(--line)] px-3 py-2">
      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-cyan-400">NL Screener</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void run()}
        placeholder='e.g. "PE 20 altı, ROIC yüksek, revenue büyüyen, desteğe yakın teknoloji şirketleri"'
        className="min-w-0 flex-1 rounded border border-[var(--line)] bg-transparent px-2 py-1 text-[11px] outline-none focus:border-cyan-500/60"
      />
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="rounded border border-cyan-500/60 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-300 disabled:opacity-50"
      >
        {busy ? "…" : "Apply"}
      </button>
      {err && <span className="max-w-[280px] truncate text-[9.5px] text-rose-400" title={err}>{err}</span>}
    </div>
  );
}

export function UniverseScreener({ initialSector }: { initialSector?: string }) {
  const [nlWhy, setNlWhy] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>({
    ...EMPTY,
    sectors: initialSector ? [initialSector] : [],
  });
  const [sortBy, setSortBy] = useState<string>("egSetupScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [data, setData] = useState<ApiResult | null>(null);
  const [pending, setPending] = useState(false);
  const seq = useRef(0);

  const run = useCallback(
    async (f: Filters, sb: string, sd: "asc" | "desc") => {
      const my = ++seq.current;
      setPending(true);
      try {
        const res = await fetch("/api/screener", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(buildQuery(f, sb, sd)),
        });
        const json = (await res.json()) as ApiResult;
        if (my === seq.current) setData(json);
      } catch {
        if (my === seq.current) setData(null);
      } finally {
        if (my === seq.current) setPending(false);
      }
    },
    [],
  );

  // Debounced auto-run: the table follows the filters, no Apply button needed.
  useEffect(() => {
    const t = setTimeout(() => void run(filters, sortBy, sortDir), 200);
    return () => clearTimeout(t);
  }, [filters, sortBy, sortDir, run]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    setFilters((f) => ({ ...f, [k]: v }));

  const sortClick = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  const activeCount = useMemo(() => {
    let c = 0;
    if (filters.text) c++;
    if (filters.mcapIdx) c++;
    c += filters.sectors.length ? 1 : 0;
    for (const k of [
      "maxPe", "maxForwardPe", "maxPb", "maxEvEbitda", "minRevenueGrowth", "minEpsGrowth",
      "minNetMargin", "minFcfYield", "minRoe", "minUpsidePct", "minRevisionScore",
      "minExpectationGap", "minTechnicalScore", "minRiskReward", "maxDistanceToSupportPct",
    ] as const)
      if (filters[k].trim() !== "") c++;
    c += filters.signals.length ? 1 : 0;
    c += filters.setups.length ? 1 : 0;
    c += filters.weeklyRegimes.length ? 1 : 0;
    c += filters.valuationConfidence.length ? 1 : 0;
    return c;
  }, [filters]);

  return (
    <div className="flex flex-col gap-3" style={{ ["--tab-accent" as string]: "#22d3ee" }}>
      {/* Header: coverage is explicit */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-[var(--line)] px-3 py-2">
        <h1 className="text-[14px] font-semibold tracking-tight">Screener</h1>
        <span className="text-[10.5px] text-[var(--ink-3)]">
          filter terminal over the precomputed canonical universe — sub-second, no provider calls
        </span>
        <div className="ml-auto flex items-center gap-2 text-[10px] tabular-nums text-[var(--ink-3)]">
          {data && (
            <>
              <span className="rounded border border-emerald-500/40 px-1.5 py-0.5 text-emerald-400">
                UNIVERSE {data.coverage.rows.toLocaleString()}
              </span>
              <span>
                {data.total.toLocaleString()} match · {data.queryMs}ms
                {pending ? " · …" : ""}
              </span>
            </>
          )}
        </div>
      </div>

      {/* NL screener: sentence → structured filters → the same deterministic query */}
      <NlBox
        onResult={(q, why) => {
          setFilters((f) => ({
            ...EMPTY,
            text: "",
            mcapIdx: 0,
            ...applyNl(f, q),
          }));
          setNlWhy(why);
        }}
      />
      {nlWhy.length > 0 && (
        <div className="rounded border border-cyan-500/30 bg-cyan-500/5 px-3 py-1.5 text-[10px] text-cyan-200">
          <span className="uppercase tracking-wider text-cyan-400">Interpreted as:</span>{" "}
          {nlWhy.join(" · ")} — filters applied below; adjust them directly if the reading is off.
        </div>
      )}

      {/* Filter terminal */}
      <div className="rounded border border-[var(--line)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2">
          <input
            value={filters.text}
            onChange={(e) => set("text", e.target.value)}
            placeholder="Search symbol or name…"
            className="w-52 rounded border border-[var(--line)] bg-transparent px-2 py-1 text-[11px] outline-none focus:border-cyan-500/60"
          />
          <div className="flex gap-1">
            {MCAP_PRESETS.map(([label], i) => (
              <button
                key={label}
                type="button"
                onClick={() => set("mcapIdx", i)}
                className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${
                  filters.mcapIdx === i
                    ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-300"
                    : "border-[var(--line)] text-[var(--ink-3)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setFilters({ ...EMPTY })}
            className="ml-auto rounded border border-[var(--line)] px-2 py-0.5 text-[9.5px] uppercase tracking-wide text-[var(--ink-3)] hover:text-[var(--ink-1,inherit)]"
          >
            Reset ({activeCount})
          </button>
        </div>

        <div className="grid gap-x-6 gap-y-2 p-3 lg:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-cyan-400/80">Valuation</div>
            <Num label="Max P/E" value={filters.maxPe} onChange={(v) => set("maxPe", v)} suffix="×" />
            <Num label="Max Fwd P/E" value={filters.maxForwardPe} onChange={(v) => set("maxForwardPe", v)} suffix="×" />
            <Num label="Max P/B" value={filters.maxPb} onChange={(v) => set("maxPb", v)} suffix="×" />
            <Num label="Max EV/EBITDA" value={filters.maxEvEbitda} onChange={(v) => set("maxEvEbitda", v)} suffix="×" />
            <Num label="Min upside" value={filters.minUpsidePct} onChange={(v) => set("minUpsidePct", v)} suffix="%" />
            <div className="mt-1 text-[9px] uppercase tracking-wider text-[var(--ink-3)]">Valuation confidence</div>
            <MultiChip
              options={["HIGH", "MEDIUM", "LOW"]}
              value={filters.valuationConfidence}
              onChange={(v) => set("valuationConfidence", v)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-cyan-400/80">Fundamentals</div>
            <Num label="Min rev growth" value={filters.minRevenueGrowth} onChange={(v) => set("minRevenueGrowth", v)} suffix="%" />
            <Num label="Min EPS growth" value={filters.minEpsGrowth} onChange={(v) => set("minEpsGrowth", v)} suffix="%" />
            <Num label="Min net margin" value={filters.minNetMargin} onChange={(v) => set("minNetMargin", v)} suffix="%" />
            <Num label="Min FCF yield" value={filters.minFcfYield} onChange={(v) => set("minFcfYield", v)} suffix="%" />
            <Num label="Min ROE" value={filters.minRoe} onChange={(v) => set("minRoe", v)} suffix="%" />
            <div className="mt-1 text-[9px] uppercase tracking-wider text-[var(--ink-3)]">Sector</div>
            <MultiChip options={SECTORS} value={filters.sectors} onChange={(v) => set("sectors", v)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-cyan-400/80">Technical & street</div>
            <Num label="Min tech score" value={filters.minTechnicalScore} onChange={(v) => set("minTechnicalScore", v)} />
            <Num label="Min revision" value={filters.minRevisionScore} onChange={(v) => set("minRevisionScore", v)} />
            <Num label="Min expc. gap" value={filters.minExpectationGap} onChange={(v) => set("minExpectationGap", v)} suffix="%" />
            <Num label="Min R:R" value={filters.minRiskReward} onChange={(v) => set("minRiskReward", v)} />
            <Num label="Max dist support" value={filters.maxDistanceToSupportPct} onChange={(v) => set("maxDistanceToSupportPct", v)} suffix="%" />
            <div className="mt-1 text-[9px] uppercase tracking-wider text-[var(--ink-3)]">Signal</div>
            <MultiChip options={SIGNALS} value={filters.signals} onChange={(v) => set("signals", v)} compactLabels />
            <div className="mt-1 text-[9px] uppercase tracking-wider text-[var(--ink-3)]">Setup</div>
            <MultiChip options={SETUPS} value={filters.setups} onChange={(v) => set("setups", v)} compactLabels />
            <div className="mt-1 text-[9px] uppercase tracking-wider text-[var(--ink-3)]">Weekly regime</div>
            <MultiChip options={REGIMES} value={filters.weeklyRegimes} onChange={(v) => set("weeklyRegimes", v)} compactLabels />
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="overflow-x-auto rounded border border-[var(--line)]">
        <table className="grid-table w-full">
          <thead>
            <tr>
              <th className="tl">Symbol</th>
              <th className="tl">Sector</th>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => sortClick(c.key)}
                  className="cursor-pointer select-none whitespace-nowrap hover:text-cyan-300"
                  title={`sort by ${c.label}`}
                >
                  {c.label}
                  {sortBy === c.key ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                </th>
              ))}
              <th className="tl">Signal</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r) => (
              <tr key={r.symbol}>
                <td className="tl whitespace-nowrap">
                  <Link href={`/ticker/${r.symbol}`} className="font-semibold hover:text-cyan-300">
                    {r.symbol}
                  </Link>
                  <span className="ml-1.5 hidden text-[9px] text-[var(--ink-3)] xl:inline">
                    {(r.name ?? "").slice(0, 22)}
                  </span>
                </td>
                <td className="tl whitespace-nowrap text-[9.5px] text-[var(--ink-3)]">{r.sector ?? "—"}</td>
                {COLS.map((c) => (
                  <td key={c.key} className={`tabular-nums ${c.cls ? c.cls(r) : ""}`}>
                    {c.render(r)}
                  </td>
                ))}
                <td className="tl whitespace-nowrap text-[9.5px]">
                  {(r.technicalSignal ?? "—").replaceAll("_", " ")}
                  {r.setupType && r.setupType !== "NONE" ? (
                    <span className="text-[var(--ink-3)]"> · {r.setupType.replaceAll("_", " ").toLowerCase()}</span>
                  ) : null}
                </td>
              </tr>
            ))}
            {data && data.rows.length === 0 && (
              <tr>
                <td colSpan={COLS.length + 3} className="tl p-4 text-[11px] text-[var(--ink-3)]">
                  No company in the {data.coverage.rows.toLocaleString()}-name universe passes these filters —
                  loosen one and the table updates instantly.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > data.rows.length && (
        <div className="text-[9.5px] text-[var(--ink-3)]">
          Showing the first {data.rows.length} of {data.total.toLocaleString()} matches (sorted by{" "}
          {COLS.find((c) => c.key === sortBy)?.label ?? sortBy}). Tighten a filter to narrow.
        </div>
      )}
    </div>
  );
}
