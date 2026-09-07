import Link from "next/link";
import { Chip, Kpi, Panel } from "@/components/shell/ui";
import { Workstation } from "@/components/chart/workstation";
import { TechnicalTab } from "@/components/ticker/technical-tab";
import { NewsTab } from "@/components/ticker/news-tab";
import { fmtNum, fmtPctPoints } from "@/lib/format";
import type { MacroTicker } from "@/lib/data/macro-tickers";
import type { EtfView } from "@/lib/data/eodhd/etf";
import type { TechnicalDecision } from "@/lib/engines/technical-v3";
import type { ClassifiedNews } from "@/lib/engines/news-classify";
import type { Candle, Quote } from "@/lib/types";

/**
 * INSTRUMENT-AWARE TICKER PAGES.
 *
 * A commodity is not a company: gold has no revenue growth, an ETF has no
 * earnings call. These layouts show ONLY what the instrument actually has —
 * price/performance/technicals for macro instruments, holdings/weights for
 * funds — instead of stock panels full of N/A.
 */

const perf = (candles: Candle[], bars: number): number | null => {
  if (candles.length < 2) return null;
  const last = candles[candles.length - 1]!.close;
  const ref = candles[Math.max(0, candles.length - 1 - bars)]?.close;
  return ref && ref > 0 ? (last / ref - 1) * 100 : null;
};

function PerfGrid({ candles, quote, last }: { candles: Candle[]; quote: Quote | null; last: number | null }) {
  const cells: Array<[string, number | null]> = [
    ["1W", perf(candles, 5)],
    ["1M", perf(candles, 22)],
    ["3M", perf(candles, 64)],
    ["6M", perf(candles, 128)],
    ["1Y", perf(candles, 253)],
    ["3Y", candles.length > 756 ? perf(candles, 756) : null],
  ];
  return (
    <Panel bodyClassName="p-0">
      <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-4 lg:grid-cols-8">
        <Kpi label="Last" value={last === null ? "—" : fmtNum(last, last > 500 ? 0 : 2)} sub={quote?.provider ?? undefined} />
        <Kpi label="Daily" value={quote ? fmtPctPoints(quote.changePercent) : "—"} tone={(quote?.changePercent ?? 0) >= 0 ? "pos" : "neg"} />
        {cells.map(([k, v]) => (
          <Kpi key={k} label={k} value={fmtPctPoints(v)} tone={(v ?? 0) >= 0 ? "pos" : "neg"} />
        ))}
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------- MACRO

export function MacroPage({
  macro,
  candles,
  quote,
  last,
  decision,
  tab,
}: {
  macro: MacroTicker;
  candles: Candle[];
  quote: Quote | null;
  last: number | null;
  decision: TechnicalDecision | null;
  tab: string;
}) {
  const kindChip =
    macro.kind === "CRYPTO" ? (
      <Chip tone="amber">CRYPTO · {macro.code.replace(".CC", "")}</Chip>
    ) : macro.kind === "INDEX" ? (
      <Chip tone="info">INDEX · {macro.code.replace(".INDX", "")}</Chip>
    ) : macro.kind === "FX" ? (
      <Chip tone="info">FX · {macro.code.replace(".FOREX", "")}</Chip>
    ) : macro.kind === "PROXY_ETF" ? (
      <Chip tone="warn" title={macro.note}>COMMODITY · ETF PROXY ({macro.code.replace(".US", "")})</Chip>
    ) : (
      <Chip tone="pos">COMMODITY · SPOT {macro.code.replace(".FOREX", "")}</Chip>
    );
  const showTech = tab === "technical";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-[var(--line)] px-3 py-2">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-[var(--amber)]/10 text-[13px] font-bold text-[var(--amber)]">
          {macro.alias.slice(0, 4)}
        </div>
        <div>
          <h1 className="text-[15px] font-semibold leading-tight">{macro.label}</h1>
          <div className="text-[10px] text-[var(--ink-3)]">{macro.code}{macro.note ? ` · ${macro.note}` : ""}</div>
        </div>
        {kindChip}
        <div className="ml-auto text-right">
          <div className="text-[16px] font-semibold tabular-nums">{last === null ? "—" : fmtNum(last, last > 500 ? 0 : 2)}</div>
          <div className={`text-[11px] tabular-nums ${(quote?.changePercent ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {quote?.changePercent != null ? fmtPctPoints(quote.changePercent) : ""}
          </div>
        </div>
      </div>

      <nav data-testid="ticker-tabs" className="flex gap-0 rounded border border-[var(--line)] text-[10.5px] font-medium">
        {(["OVERVIEW", "TECHNICAL"] as const).map((t) => (
          <Link
            key={t}
            href={`/ticker/${macro.alias}?tab=${t.toLowerCase()}`}
            className={`border-b-2 px-3 py-1.5 uppercase tracking-wider ${
              (showTech ? "TECHNICAL" : "OVERVIEW") === t ? "border-[var(--amber)]" : "border-transparent text-[var(--ink-3)]"
            }`}
          >
            {t}
          </Link>
        ))}
      </nav>

      {!showTech && (
        <>
          <PerfGrid candles={candles} quote={quote} last={last} />
          <Panel
            title="Chart"
            actions={
              <Link href={`/chart/${macro.alias}`} className="rounded border border-cyan-500/70 bg-cyan-500/10 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-cyan-300">
                ⛶ Full Screen
              </Link>
            }
            bodyClassName="p-0"
          >
            <Workstation symbol={macro.alias} compact />
          </Panel>
        </>
      )}
      {showTech &&
        (decision ? (
          <TechnicalTab decision={decision} candles={candles} />
        ) : (
          <Panel title="Technical">Not enough history for the V3 engine.</Panel>
        ))}
    </div>
  );
}

// --------------------------------------------------------------------- ETF

export function EtfPage({
  view,
  symbol,
  candles,
  quote,
  last,
  decision,
  news,
  tab,
}: {
  view: EtfView;
  symbol: string;
  candles: Candle[];
  quote: Quote | null;
  last: number | null;
  decision: TechnicalDecision | null;
  news: ClassifiedNews[];
  tab: string;
}) {
  const p = view.profile;
  const aum = p.aum !== null ? (p.aum >= 1e12 ? `$${(p.aum / 1e12).toFixed(2)}T` : `$${(p.aum / 1e9).toFixed(1)}B`) : "N/A";
  const active = tab === "technical" ? "TECHNICAL" : tab === "news" ? "NEWS" : "OVERVIEW";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-[var(--line)] px-3 py-2">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-violet-500/10 text-[13px] font-bold text-violet-300">
          {symbol.slice(0, 4)}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold leading-tight">{p.name ?? symbol}</h1>
          <div className="text-[10px] text-[var(--ink-3)]">
            {view.indexName ? `tracks ${view.indexName} · ` : ""}AUM {aum}
            {p.expenseRatio !== null ? ` · expense ${(p.expenseRatio * 100).toFixed(2)}%` : ""}
            {p.dividendYield !== null ? ` · yield ${p.dividendYield.toFixed(2)}%` : ""}
            {view.turnoverPct !== null ? ` · turnover ${view.turnoverPct.toFixed(0)}%` : ""}
          </div>
        </div>
        <Chip tone="info">ETF · {view.holdings.length} holdings shown</Chip>
        <div className="ml-auto text-right">
          <div className="text-[16px] font-semibold tabular-nums">{last === null ? "—" : fmtNum(last, 2)}</div>
          <div className={`text-[11px] tabular-nums ${(quote?.changePercent ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {quote?.changePercent != null ? fmtPctPoints(quote.changePercent) : ""}
          </div>
        </div>
      </div>

      <nav data-testid="ticker-tabs" className="flex gap-0 rounded border border-[var(--line)] text-[10.5px] font-medium">
        {(["OVERVIEW", "TECHNICAL", "NEWS"] as const).map((t) => (
          <Link
            key={t}
            href={`/ticker/${symbol}?tab=${t.toLowerCase()}`}
            className={`border-b-2 px-3 py-1.5 uppercase tracking-wider ${active === t ? "border-violet-400" : "border-transparent text-[var(--ink-3)]"}`}
          >
            {t}
          </Link>
        ))}
      </nav>

      {active === "OVERVIEW" && (
        <>
          <PerfGrid candles={candles} quote={quote} last={last} />
          <div className="grid gap-3 lg:grid-cols-3">
            <Panel title="Top Holdings" subtitle={`heaviest ${Math.min(view.holdings.length, 25)} positions · EODHD fund file`} bodyClassName="p-0" className="lg:col-span-2">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th className="tl">#</th>
                    <th className="tl">Holding</th>
                    <th className="tl">Sector</th>
                    <th>Weight</th>
                    <th className="tl"></th>
                  </tr>
                </thead>
                <tbody>
                  {view.holdings.slice(0, 25).map((h, i) => (
                    <tr key={h.ticker}>
                      <td className="tl tabular-nums text-[var(--ink-3)]">{i + 1}</td>
                      <td className="tl">
                        <Link href={`/ticker/${h.ticker}`} className="font-semibold hover:text-violet-300">{h.ticker}</Link>
                        <span className="ml-1.5 text-[9.5px] text-[var(--ink-3)]">{h.name.slice(0, 28)}</span>
                      </td>
                      <td className="tl text-[10px] text-[var(--ink-3)]">{h.sector ?? "—"}</td>
                      <td className="tabular-nums font-medium">{h.weight.toFixed(2)}%</td>
                      <td className="tl w-28">
                        <div className="h-1.5 overflow-hidden rounded bg-[var(--line)]">
                          <div className="h-full bg-violet-400/70" style={{ width: `${Math.min(100, (h.weight / (view.holdings[0]?.weight || 1)) * 100)}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
            <div className="flex flex-col gap-3">
              <Panel title="Sector Weights" bodyClassName="p-2">
                {view.sectorWeights.slice(0, 11).map((s) => (
                  <div key={s.sector} className="flex items-center gap-2 py-0.5 text-[10.5px]">
                    <span className="w-36 truncate text-[var(--ink-2)]">{s.sector}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded bg-[var(--line)]">
                      <div className="h-full bg-violet-400/70" style={{ width: `${s.pct}%` }} />
                    </div>
                    <span className="w-11 text-right tabular-nums">{s.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </Panel>
              {view.assetAllocation.length > 0 && (
                <Panel title="Asset Allocation" bodyClassName="p-2">
                  {view.assetAllocation.map((a) => (
                    <div key={a.bucket} className="flex justify-between py-0.5 text-[10.5px]">
                      <span className="text-[var(--ink-2)]">{a.bucket}</span>
                      <span className="tabular-nums">{a.pct.toFixed(1)}%</span>
                    </div>
                  ))}
                </Panel>
              )}
            </div>
          </div>
          <Panel
            title="Chart"
            actions={
              <Link href={`/chart/${symbol}`} className="rounded border border-cyan-500/70 bg-cyan-500/10 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-cyan-300">
                ⛶ Full Screen
              </Link>
            }
            bodyClassName="p-0"
          >
            <Workstation symbol={symbol} compact />
          </Panel>
        </>
      )}
      {active === "TECHNICAL" &&
        (decision ? <TechnicalTab decision={decision} candles={candles} /> : <Panel title="Technical">Not enough history.</Panel>)}
      {active === "NEWS" && <NewsTab news={news} symbol={symbol} />}
    </div>
  );
}
