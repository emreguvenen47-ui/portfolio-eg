import Link from "next/link";
import "@/lib/providers/register";
import { Panel } from "@/components/shell/ui";
import { getQuotes } from "@/lib/providers";
import { getMacroTape } from "@/lib/data/macro-tape";
import { getUniverseRows, getUniverseMeta } from "@/lib/data/opportunities";

/**
 * MARKET PULSE — the "everything at a glance" top of the Markets page:
 * sector board (real SPDR fund moves), macro strip (indices/commodities/
 * crypto), and the universe pulse computed from the precomputed 6.9k table.
 * Server-rendered; the only live calls are two bulk quote requests.
 */

const SECTOR_ETFS: Array<[string, string]> = [
  ["XLK", "Technology"],
  ["XLF", "Financials"],
  ["XLE", "Energy"],
  ["XLV", "Health Care"],
  ["XLI", "Industrials"],
  ["XLY", "Cons. Discretionary"],
  ["XLP", "Cons. Staples"],
  ["XLU", "Utilities"],
  ["XLB", "Materials"],
  ["XLRE", "Real Estate"],
  ["XLC", "Communication"],
  ["SMH", "Semiconductors"],
];

const bg = (chg: number | null): string => {
  if (chg === null) return "rgba(148,163,184,0.08)";
  const x = Math.max(-2.5, Math.min(2.5, chg)) / 2.5;
  return x >= 0 ? `rgba(16,185,129,${0.08 + x * 0.3})` : `rgba(244,63,94,${0.08 - x * 0.3})`;
};

export async function MarketPulse() {
  const [tape, sectorQuotes] = await Promise.all([
    getMacroTape().catch(() => []),
    getQuotes(SECTOR_ETFS.map(([s]) => s)).catch(() => ({}) as Awaited<ReturnType<typeof getQuotes>>),
  ]);

  const rows = getUniverseRows();
  const meta = getUniverseMeta();
  const buys = rows.filter((r) =>
    ["STRONG_BUY", "BUY", "BREAKOUT_BUY", "BUY_ON_RETEST", "TACTICAL_BUY"].includes(r.technicalSignal ?? ""),
  ).length;
  const breakouts = rows.filter((r) => r.technicalSignal === "BREAKOUT_PENDING" || r.setupType === "BREAKOUT").length;
  const upsides = rows.map((r) => r.upsidePct).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const medianUpside = upsides.length ? upsides[Math.floor(upsides.length / 2)]! : null;
  const top = rows
    .filter((r) => r.egSetupScore !== null)
    .sort((a, b) => (b.egSetupScore ?? 0) - (a.egSetupScore ?? 0))
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-3">
      {/* Sector board */}
      <Panel title="Sector Board" subtitle="today's move per S&P sector — real SPDR fund prices, tile → sector fund page" bodyClassName="p-2">
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 xl:grid-cols-6">
          {SECTOR_ETFS.map(([sym, label]) => {
            const q = sectorQuotes[sym] ?? null;
            const chg = q?.changePercent ?? null;
            return (
              <Link key={sym} href={`/ticker/${sym}`} className="rounded border border-[var(--line)] p-2 transition-transform hover:scale-[1.02]" style={{ background: bg(chg) }}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[10.5px] font-semibold">{label}</span>
                  <span className="text-[8.5px] text-[var(--ink-3)]">{sym}</span>
                </div>
                <div className={`mt-0.5 text-[14px] font-bold tabular-nums ${(chg ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {chg === null ? "—" : `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`}
                </div>
                <div className="text-[8.5px] tabular-nums text-[var(--ink-3)]">{q?.price != null ? q.price.toFixed(2) : ""}</div>
              </Link>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-3 xl:grid-cols-2">
        {/* Macro strip */}
        <Panel title="Macro & Commodities" subtitle="indices · metals · energy · crypto — each opens its full page" bodyClassName="p-0">
          <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-4">
            {tape.map((t) => (
              <Link key={t.alias} href={`/ticker/${t.alias}`} className="px-3 py-2 hover:bg-white/5">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] font-semibold">{t.alias}</span>
                  <span className="text-[8px] uppercase text-[var(--ink-3)]">{t.kind.replace("PROXY_ETF", "ETF")}</span>
                </div>
                <div className="text-[13px] font-semibold tabular-nums">
                  {t.price === null ? "—" : t.price.toLocaleString("en-US", { maximumFractionDigits: t.price > 500 ? 0 : 2 })}
                </div>
                <div className={`text-[10px] tabular-nums ${(t.changePct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {t.changePct === null ? "" : `${t.changePct >= 0 ? "▲" : "▼"}${Math.abs(t.changePct).toFixed(2)}%`}
                </div>
              </Link>
            ))}
          </div>
        </Panel>

        {/* Universe pulse */}
        <Panel
          title="Universe Pulse"
          subtitle={`signal counts over ${meta.rows.toLocaleString()} precomputed companies · refreshed ${meta.newest ? meta.newest.slice(5, 16).replace("T", " ") : "—"}`}
          bodyClassName="p-0"
        >
          <div className="grid grid-cols-3 divide-x divide-[var(--line)] border-b border-[var(--line)]">
            {[
              ["Buy-family signals", buys, "#34d399"],
              ["Breakout candidates", breakouts, "#22d3ee"],
              ["Median model upside", medianUpside === null ? "—" : `${medianUpside > 0 ? "+" : ""}${medianUpside.toFixed(0)}%`, "#f59e0b"],
            ].map(([k, v, c]) => (
              <div key={k as string} className="px-3 py-2">
                <div className="text-[8.5px] uppercase tracking-wider text-[var(--ink-3)]">{k}</div>
                <div className="text-[16px] font-bold tabular-nums" style={{ color: c as string }}>
                  {typeof v === "number" ? v.toLocaleString() : v}
                </div>
              </div>
            ))}
          </div>
          <div className="px-3 py-2">
            <div className="text-[8.5px] uppercase tracking-wider text-[var(--ink-3)]">Top EG setups right now</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {top.map((r) => (
                <Link key={r.symbol} href={`/ticker/${r.symbol}`} className="rounded border border-[var(--line)] px-2 py-1 text-[10px] hover:border-amber-500/60">
                  <span className="font-semibold">{r.symbol}</span>
                  <span className="ml-1 tabular-nums text-amber-400">{r.egSetupScore}</span>
                  <span className="ml-1 text-[9px] text-[var(--ink-3)]">{(r.technicalSignal ?? "").replaceAll("_", " ").toLowerCase()}</span>
                </Link>
              ))}
              <Link href="/opportunities" className="rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-400">
                all opportunities →
              </Link>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
