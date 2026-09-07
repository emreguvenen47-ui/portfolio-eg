import Link from "next/link";
import { Chip } from "@/components/shell/ui";
import type { EgBundle } from "@/lib/engines/eg-bundle";
import type { TechnicalDecision } from "@/lib/engines/technical-v3";
import type { Quote } from "@/lib/types";

/**
 * TICKER TERMINAL CHROME — header, decision bar, quick thesis and tab nav.
 * Server components; the tab is a URL param so every state is linkable.
 */

export const TICKER_TABS = [
  "OVERVIEW",
  "TECHNICAL",
  "VALUATION",
  "FINANCIALS",
  "ANALYSTS",
  "NEWS",
  "OPTIONS",
  "OWNERSHIP",
  "EARNINGS",
  "RESEARCH",
] as const;
export type TickerTab = (typeof TICKER_TABS)[number];

export function normalizeTab(raw: string | undefined, hasEg: boolean): TickerTab {
  const up = (raw ?? "").toUpperCase() as TickerTab;
  if ((TICKER_TABS as readonly string[]).includes(up)) return up;
  return "OVERVIEW";
}

const fmtMcap = (v: number | null): string => {
  if (v === null) return "N/A";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
};

/** Company identity header: monogram, name, venue, size, freshness. */
export function TickerHeader({
  symbol,
  eg,
  quote,
  last,
  bist,
}: {
  symbol: string;
  eg: EgBundle | null;
  quote: Quote | null;
  last: number | null;
  bist: boolean;
}) {
  const id = eg?.snapshot.identity ?? null;
  const meta = eg?.snapshot.meta ?? null;
  const chg = quote?.changePercent ?? null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-[var(--line)] bg-[var(--panel,transparent)] px-3 py-2">
      <div className="flex h-9 w-9 items-center justify-center rounded bg-[var(--amber)]/10 text-[13px] font-bold tracking-tight text-[var(--amber)]">
        {symbol.slice(0, 4)}
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <h1 className="text-[15px] font-semibold leading-tight">{id?.name ?? symbol}</h1>
          <span className="text-[11px] text-[var(--ink-3)]">
            {symbol}
            {id?.exchange ? ` · ${id.exchange}` : ""}
          </span>
        </div>
        <div className="text-[10px] text-[var(--ink-3)]">
          {id?.sector ?? "—"}
          {id?.industry ? ` · ${id.industry}` : ""} · Mcap {fmtMcap(eg?.snapshot.marketCap ?? null)}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <div className="text-right">
          <div className="text-[16px] font-semibold tabular-nums leading-tight">
            {last === null ? "—" : last.toFixed(last > 500 ? 2 : 2)}
          </div>
          <div
            className={`text-[11px] tabular-nums ${(chg ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}
          >
            {chg === null ? "—" : `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`}
          </div>
        </div>
        {bist ? (
          <Chip tone="warn" title="Borsa İstanbul prices reach this app through Yahoo and are delayed.">
            BIST · DELAYED
          </Chip>
        ) : meta ? (
          <Chip
            tone={meta.dataDelayed ? "warn" : "pos"}
            title={`Statements through ${meta.latestStatementPeriod ?? "?"} · reported ${meta.latestReportedPeriod ?? "?"} · EODHD`}
          >
            {meta.dataDelayed ? "DATA DELAYED" : "CURRENT"} · {meta.latestStatementPeriod ?? "?"}
          </Chip>
        ) : null}
      </div>
    </div>
  );
}

function barTone(kind: "pos" | "neg" | "flat"): string {
  return kind === "pos" ? "text-emerald-400" : kind === "neg" ? "text-rose-400" : "text-[var(--ink-2)]";
}

/** One-line professional decision bar: SIGNAL | SETUP | SCORE | CONFIDENCE | VALUATION | UPSIDE | R:R.
 * Works from the candle-only technical decision when fundamentals are down —
 * valuation/analyst cells then read an honest N/A instead of hiding the bar. */
export function DecisionBar({ eg, decision }: { eg: EgBundle | null; decision: TechnicalDecision }) {
  const t = decision;
  const d = eg?.decision ?? null;
  const upside =
    eg && eg.expectations.consensus.target !== null && eg.price > 0
      ? (eg.expectations.consensus.target / eg.price - 1) * 100
      : null;
  const buyish = ["STRONG_BUY", "BUY", "BREAKOUT_BUY", "BUY_ON_RETEST", "TACTICAL_BUY"].includes(t.signal);
  const sellish = ["SELL", "REDUCE", "INVALIDATED"].includes(t.signal);
  const cells: Array<{ k: string; v: string; cls?: string; sub?: string }> = [
    {
      k: "SIGNAL",
      v: t.signal.replaceAll("_", " "),
      cls: barTone(buyish ? "pos" : sellish ? "neg" : "flat"),
      sub: t.freshness,
    },
    { k: "SETUP", v: t.setup === "NONE" ? "—" : t.setup.replaceAll("_", " "), sub: t.counterTrend ? "COUNTER-TREND" : undefined },
    { k: "SCORE", v: t.score ? `${t.score.total}/100` : "N/A" },
    { k: "CONFIDENCE", v: t.confidence },
    {
      k: "VALUATION",
      v: d ? d.view.replaceAll("_", " ") : "N/A",
      cls: barTone(d && d.view === "ATTRACTIVE" ? "pos" : d && (d.view === "EXPENSIVE" || d.view === "HIGH_RISK") ? "neg" : "flat"),
      sub: d?.upsidePct != null ? `EG ${d.upsidePct > 0 ? "+" : ""}${d.upsidePct.toFixed(0)}%` : undefined,
    },
    {
      k: "ANALYST UPSIDE",
      v: upside === null ? "N/A" : `${upside > 0 ? "+" : ""}${upside.toFixed(1)}%`,
      cls: barTone(upside === null ? "flat" : upside >= 0 ? "pos" : "neg"),
      sub: d?.consensusLabel ?? undefined,
    },
    { k: "R:R", v: t.riskReward === null ? "N/A" : `${t.riskReward}`, sub: t.riskPct !== null ? `risk ${t.riskPct}%` : undefined },
  ];
  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] rounded border border-[var(--line)] sm:grid-cols-4 lg:grid-cols-7 lg:divide-y-0">
      {cells.map((c) => (
        <div key={c.k} className="px-3 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">{c.k}</div>
          <div className={`text-[12px] font-semibold tabular-nums ${c.cls ?? ""}`}>{c.v}</div>
          {c.sub ? <div className="truncate text-[9px] text-[var(--ink-3)]" title={c.sub}>{c.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}

/** Quick thesis: the six questions, answered from computed data only. */
export function QuickThesisPanel({ eg }: { eg: EgBundle }) {
  const th = eg.thesis;
  if (!th.bull.length && !th.bear.length && !th.whatChanged && !th.marketPricing) return null;
  return (
    <div className="rounded border border-[var(--line)]">
      <div className="grid gap-0 sm:grid-cols-2">
        <div className="border-b border-[var(--line)] p-3 sm:border-b-0 sm:border-r">
          <div className="text-[9px] uppercase tracking-wider text-emerald-400">Bull case</div>
          {th.bull.length ? (
            <ul className="mt-1 list-disc pl-4 text-[11.5px] leading-snug">
              {th.bull.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : (
            <div className="mt-1 text-[11px] text-[var(--ink-3)]">No positive signal cleared the bar.</div>
          )}
        </div>
        <div className="p-3">
          <div className="text-[9px] uppercase tracking-wider text-rose-400">Bear case</div>
          {th.bear.length ? (
            <ul className="mt-1 list-disc pl-4 text-[11.5px] leading-snug">
              {th.bear.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : (
            <div className="mt-1 text-[11px] text-[var(--ink-3)]">No negative signal cleared the bar.</div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 divide-y divide-[var(--line)] border-t border-[var(--line)] text-[11px] leading-snug sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
        {[
          ["What changed", th.whatChanged],
          ["What the market is pricing", th.marketPricing],
          ["Main catalyst", th.mainCatalyst],
          ["Main risk", th.mainRisk],
        ].map(([k, v]) => (
          <div key={k as string} className="px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">{k}</div>
            <div className="mt-0.5">{v ?? <span className="text-[var(--ink-3)]">N/A</span>}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** COMPANY PLAN — what the company is doing, every line cited or filed. */
export function CompanyPlanPanel({ eg }: { eg: EgBundle }) {
  const p = eg.plan;
  const has = p.growthOutlook.length || p.initiatives.length || p.capitalAllocation.length || p.watchouts.length;
  if (!has) return null;
  const Item = ({ text, source }: { text: string; source: { title: string; date: string; url: string } | null }) => (
    <li className="leading-snug">
      {source ? (
        <a href={source.url} target="_blank" rel="noreferrer" className="hover:text-[var(--amber)] hover:underline">
          {text}
        </a>
      ) : (
        text
      )}
      {source ? <span className="ml-1 text-[9px] text-[var(--ink-3)]">({source.date})</span> : null}
    </li>
  );
  return (
    <div className="rounded border border-[var(--line)]">
      <div className="flex items-baseline gap-2 border-b border-[var(--line)] px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--amber)]">Company Plan</span>
        <span className="text-[9.5px] to-[var(--ink-3)] text-[var(--ink-3)]">
          what the company is doing — every line cites a headline or a filing, nothing invented
        </span>
      </div>
      <div className="grid grid-cols-1 divide-y divide-[var(--line)] text-[11px] sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
        <div className="p-3">
          <div className="text-[9px] uppercase tracking-wider text-emerald-400">Growth outlook</div>
          {p.growthOutlook.length ? (
            <ul className="mt-1 list-disc space-y-1 pl-4">{p.growthOutlook.map((g) => <li key={g} className="leading-snug">{g}</li>)}</ul>
          ) : (
            <div className="mt-1 text-[var(--ink-3)]">No street path published.</div>
          )}
        </div>
        <div className="p-3">
          <div className="text-[9px] uppercase tracking-wider text-cyan-300">Initiatives (news-cited)</div>
          {p.initiatives.length ? (
            <ul className="mt-1 list-disc space-y-1 pl-4">{p.initiatives.map((i) => <Item key={i.text} {...i} />)}</ul>
          ) : (
            <div className="mt-1 text-[var(--ink-3)]">No initiative headlines in the recent window — honest empty.</div>
          )}
        </div>
        <div className="p-3">
          <div className="text-[9px] uppercase tracking-wider text-[var(--amber)]">Capital allocation (filed)</div>
          {p.capitalAllocation.length ? (
            <ul className="mt-1 list-disc space-y-1 pl-4">{p.capitalAllocation.map((c) => <li key={c} className="leading-snug">{c}</li>)}</ul>
          ) : (
            <div className="mt-1 text-[var(--ink-3)]">Cash-flow detail unavailable.</div>
          )}
        </div>
        <div className="p-3">
          <div className="text-[9px] uppercase tracking-wider text-rose-400">Watchouts (news-cited)</div>
          {p.watchouts.length ? (
            <ul className="mt-1 list-disc space-y-1 pl-4">{p.watchouts.map((w) => <Item key={w.text} {...w} />)}</ul>
          ) : (
            <div className="mt-1 text-[var(--ink-3)]">No regulatory/legal/supply headlines recently.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Per-tab accent so each product area has its own character. */
export const TAB_ACCENT: Record<TickerTab, string> = {
  OVERVIEW: "var(--amber)",
  TECHNICAL: "#22d3ee",
  VALUATION: "#f59e0b",
  FINANCIALS: "#34d399",
  ANALYSTS: "#a78bfa",
  NEWS: "#60a5fa",
  OPTIONS: "#2dd4bf",
  OWNERSHIP: "#94a3b8",
  EARNINGS: "#fb923c",
  RESEARCH: "#f472b6",
};

export function TabNav({
  symbol,
  active,
}: {
  symbol: string;
  active: TickerTab;
  /** Kept for call-site compatibility; tabs are ALWAYS all visible — a tab
   * whose data source is down shows an honest empty state, it never vanishes. */
  hasEg?: boolean;
}) {
  const tabs = TICKER_TABS;
  return (
    <nav data-testid="ticker-tabs" className="flex flex-wrap gap-0 overflow-x-auto rounded border border-[var(--line)] text-[10.5px] font-medium">
      {tabs.map((t) => {
        const on = t === active;
        return (
          <Link
            key={t}
            href={`/ticker/${encodeURIComponent(symbol)}?tab=${t.toLowerCase()}`}
            className={`border-b-2 px-3 py-1.5 uppercase tracking-wider transition-colors ${
              on ? "text-[var(--ink-1,inherit)]" : "border-transparent text-[var(--ink-3)] hover:text-[var(--ink-2)]"
            }`}
            style={on ? { borderBottomColor: TAB_ACCENT[t] } : undefined}
          >
            {t}
          </Link>
        );
      })}
    </nav>
  );
}
