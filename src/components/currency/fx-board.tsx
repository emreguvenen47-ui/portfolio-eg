import Link from "next/link";
import { Panel } from "@/components/shell/ui";
import { getFxBoard } from "@/lib/data/fx-board";

/**
 * GLOBAL FX BOARD — 14 major pairs with a 90-day track each. Server-rendered
 * from EODHD FOREX closes (6h disk cache); every tile opens the pair's own
 * page (/ticker/EURUSD → macro instrument layout + full chart workstation).
 */

function Spark({ values }: { values: number[] }) {
  if (values.length < 5) return null;
  const W = 140;
  const H = 34;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${((i / (values.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - min) / span) * (H - 4)).toFixed(1)}`)
    .join(" ");
  const up = values[values.length - 1]! >= values[0]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-8 w-full" aria-hidden>
      <path d={d} fill="none" strokeWidth={1.4} className={up ? "stroke-emerald-400/80" : "stroke-rose-400/80"} />
    </svg>
  );
}

export async function FxBoard() {
  const rows = await getFxBoard().catch(() => []);
  if (!rows.length) return null;
  const pct = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
  return (
    <Panel
      title="Global FX Board"
      subtitle="14 major pairs · 90-day track · click any pair for its full page and chart workstation"
      bodyClassName="p-2"
    >
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-7">
        {rows.map((r) => (
          <Link key={r.alias} href={`/ticker/${r.alias}`} className="rounded border border-[var(--line)] p-2 transition-colors hover:border-cyan-500/50">
            <div className="flex items-baseline justify-between">
              <span className="text-[10.5px] font-semibold">{r.pair}</span>
              <span className={`text-[9px] tabular-nums ${(r.chg1dPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{pct(r.chg1dPct)}</span>
            </div>
            <div className="text-[13px] font-bold tabular-nums">{r.last === null ? "—" : r.last.toFixed(r.decimals)}</div>
            <Spark values={r.spark} />
            <div className="flex justify-between text-[8.5px] tabular-nums text-[var(--ink-3)]">
              <span>1M {pct(r.chg1mPct)}</span>
              <span>YTD {pct(r.chgYtdPct)}</span>
            </div>
          </Link>
        ))}
      </div>
    </Panel>
  );
}
