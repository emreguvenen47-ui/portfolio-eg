"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { PolymarketMarket } from "@/lib/providers/polymarket";

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const compact = (n: number | null) =>
  n === null ? "N/A" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${(n / 1e3).toFixed(0)}K`;

export function MarketTable({
  markets,
  categories,
  active,
}: {
  markets: PolymarketMarket[];
  categories: { id: string; label: string }[];
  active: string;
}) {
  const [q, setQ] = useState("");
  const rows = useMemo(
    () =>
      q.trim()
        ? markets.filter((m) => m.question.toLowerCase().includes(q.trim().toLowerCase()))
        : markets,
    [markets, q],
  );

  return (
    <section className="panel">
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--line)] px-2 py-1.5">
        {categories.map((c) => (
          <Link
            key={c.id}
            href={`/polymarket?c=${c.id}`}
            className={cn(
              "rounded-sm border px-2 py-0.5 text-[10px]",
              active === c.id
                ? "border-[var(--amber)] bg-[rgba(255,160,40,0.12)] text-[var(--amber)]"
                : "border-[var(--line)] text-[var(--ink-3)] hover:border-[var(--ink-3)]",
            )}
          >
            {c.label}
          </Link>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search markets"
          className="ml-auto min-w-[160px] rounded-sm border border-[var(--line)] bg-[var(--panel-2)] px-2 py-0.5 text-[11px] outline-none focus:border-[var(--amber)]"
        />
      </div>

      {rows.length === 0 ? (
        <div className="p-4 text-center text-[11px] text-[var(--ink-3)]">
          No open market matches this category.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Market</th>
                <th className="tl">Outcome</th>
                <th>Implied</th>
                <th>24H</th>
                <th>7D</th>
                <th>Volume</th>
                <th>Liquidity</th>
                <th className="tl">Ends</th>
              </tr>
            </thead>
            <tbody>
              {rows.flatMap((m) =>
                m.outcomes.slice(0, 4).map((o, i) => (
                  <tr key={`${m.id}-${o.label}`}>
                    {i === 0 && (
                      <td className="tl max-w-[320px] whitespace-normal" rowSpan={Math.min(4, m.outcomes.length)}>
                        <a href={m.url} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--amber)]">
                          {m.question}
                        </a>
                      </td>
                    )}
                    <td className="tl">{o.label}</td>
                    <td className="tabular-nums font-semibold">{pct(o.probability)}</td>
                    <td className={cn("tabular-nums", (o.change24h ?? 0) > 0 ? "text-emerald-400" : (o.change24h ?? 0) < 0 ? "text-rose-400" : "text-[var(--ink-3)]")}>
                      {o.change24h === null ? "N/A" : `${o.change24h > 0 ? "+" : ""}${(o.change24h * 100).toFixed(1)}pp`}
                    </td>
                    <td className={cn("tabular-nums", (o.change7d ?? 0) > 0 ? "text-emerald-400" : (o.change7d ?? 0) < 0 ? "text-rose-400" : "text-[var(--ink-3)]")}>
                      {o.change7d === null ? "N/A" : `${o.change7d > 0 ? "+" : ""}${(o.change7d * 100).toFixed(1)}pp`}
                    </td>
                    {i === 0 && (
                      <>
                        <td className="tabular-nums" rowSpan={Math.min(4, m.outcomes.length)}>{compact(m.volume)}</td>
                        <td className="tabular-nums" rowSpan={Math.min(4, m.outcomes.length)}>{compact(m.liquidity)}</td>
                        <td className="tl text-[10px] text-[var(--ink-3)]" rowSpan={Math.min(4, m.outcomes.length)}>
                          {m.endDate?.slice(0, 10) ?? "N/A"}
                        </td>
                      </>
                    )}
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
        Source: Polymarket public API · discovery cached 15 min, pricing 3 min. 24H and 7D
        changes are reported by the API for the primary outcome only and read N/A elsewhere.
      </div>
    </section>
  );
}
