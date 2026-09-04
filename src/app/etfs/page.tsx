import "@/lib/providers/register";
import Link from "next/link";
import { Panel } from "@/components/shell/ui";
import { getQuotes } from "@/lib/providers";
import { MAJOR_ETFS } from "@/lib/data/etf-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "ETFs" };

/**
 * ETF DESK — the major-fund universe, grouped by category. Every row opens the
 * fund's ticker page, where the full holdings table (weights, sectors) and the
 * technical workstation live. Quotes come from the normal provider chain.
 */
export default async function EtfsPage() {
  const symbols = MAJOR_ETFS.map((e) => e.symbol);
  const quotes = await getQuotes(symbols).catch(() => ({}) as Awaited<ReturnType<typeof getQuotes>>);
  const cats = [...new Set(MAJOR_ETFS.map((e) => e.category))];

  return (
    <div className="flex flex-col gap-3" style={{ ["--tab-accent" as string]: "#a78bfa" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-[var(--line)] px-3 py-2">
        <h1 className="text-[14px] font-semibold tracking-tight">ETFs</h1>
        <span className="text-[10.5px] text-[var(--ink-3)]">
          {MAJOR_ETFS.length} major funds — click any fund for holdings, sector weights and the chart workstation
        </span>
      </div>

      {cats.map((cat) => (
        <Panel key={cat} title={cat} bodyClassName="p-0">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Fund</th>
                <th className="tl">Name</th>
                <th>Price</th>
                <th>Daily</th>
                <th className="tl">Open</th>
              </tr>
            </thead>
            <tbody>
              {MAJOR_ETFS.filter((e) => e.category === cat).map((e) => {
                const q = quotes[e.symbol] ?? null;
                const chg = q?.changePercent ?? null;
                return (
                  <tr key={e.symbol}>
                    <td className="tl">
                      <Link href={`/ticker/${e.symbol}`} className="font-semibold hover:text-violet-300">
                        {e.symbol}
                      </Link>
                    </td>
                    <td className="tl text-[10.5px] text-[var(--ink-3)]">{e.name}</td>
                    <td className="tabular-nums">{q?.price != null ? q.price.toFixed(2) : "—"}</td>
                    <td className={`tabular-nums ${(chg ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {chg === null ? "—" : `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`}
                    </td>
                    <td className="tl text-[10px]">
                      <Link href={`/ticker/${e.symbol}`} className="text-violet-300/80 hover:underline">holdings</Link>
                      <span className="text-[var(--ink-3)]"> · </span>
                      <Link href={`/chart/${e.symbol}`} className="text-cyan-300/80 hover:underline">chart</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      ))}
    </div>
  );
}
