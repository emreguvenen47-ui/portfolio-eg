"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * One manager's reported book: what it holds, what it bought, what it sold.
 *
 * The chart is a donut of the top positions with the rest collapsed into one
 * slice, because a pie of four hundred holdings is a colour wheel. Slices are
 * percentages of the REPORTED table — long US equity only — which is stated
 * beside the total rather than left implied.
 */

interface Position {
  ticker: string | null;
  issuer: string;
  value: number;
  shares: number;
  weight: number;
  changeShares: number | null;
  changePct: number | null;
  action: "NEW" | "ADDED" | "TRIMMED" | "EXITED" | "HELD";
}

export interface Fund {
  cik: string;
  manager: string;
  period: string;
  filedAt: string;
  staleQuarters: number;
  reportedValue: number;
  positions: number;
  top: Position[];
  increased: Position[];
  reduced: Position[];
  firstFiling: boolean;
}

const COLOURS = [
  "#ffa028", "#4ade80", "#60a5fa", "#f472b6", "#a78bfa", "#fbbf24",
  "#34d399", "#38bdf8", "#fb7185", "#c084fc", "#facc15", "#2dd4bf",
];
const REST = "#3f3f46";

const money = (v: number) =>
  v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T`
  : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B`
  : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M`
  : `$${v.toFixed(0)}`;

const shares = (v: number) =>
  Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v);

const ACTION_TONE: Record<Position["action"], string> = {
  NEW: "text-emerald-400",
  ADDED: "text-emerald-400/80",
  TRIMMED: "text-rose-400/80",
  EXITED: "text-rose-400",
  HELD: "text-[var(--ink-3)]",
};

/** Donut built from stroke-dasharray, so there is no chart dependency. */
function Donut({ slices }: { slices: { label: string; pct: number; colour: string }[] }) {
  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <svg viewBox="0 0 100 100" className="h-[150px] w-[150px] shrink-0 -rotate-90">
      {slices.map((s) => {
        const len = (s.pct / 100) * C;
        const el = (
          <circle
            key={s.label}
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={s.colour}
            strokeWidth="14"
            strokeDasharray={`${len} ${C - len}`}
            strokeDashoffset={-offset}
          >
            <title>{`${s.label} · ${s.pct.toFixed(1)}%`}</title>
          </circle>
        );
        offset += len;
        return el;
      })}
    </svg>
  );
}

export function FundAllocation({ fund }: { fund: Fund }) {
  const [tab, setTab] = useState<"holdings" | "increased" | "reduced">("holdings");

  const topWeight = fund.top.reduce((s, p) => s + p.weight, 0);
  const slices = [
    ...fund.top.map((p, i) => ({
      label: p.ticker ?? p.issuer,
      pct: p.weight,
      colour: COLOURS[i % COLOURS.length],
    })),
    ...(topWeight < 99.5
      ? [{ label: `${fund.positions - fund.top.length} smaller positions`, pct: 100 - topWeight, colour: REST }]
      : []),
  ];

  const rows = tab === "holdings" ? fund.top : tab === "increased" ? fund.increased : fund.reduced;

  return (
    <section className="panel">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--line)] px-3 py-2">
        <span className="text-[12px] font-semibold">{fund.manager}</span>
        <span className="text-[10px] text-[var(--ink-3)]">
          {money(fund.reportedValue)} reported · {fund.positions.toLocaleString()} positions
        </span>
        <span className="ml-auto text-[10px] text-[var(--ink-3)]">
          Q/E {fund.period} · filed {fund.filedAt}
        </span>
      </div>

      {fund.staleQuarters > 0 && (
        <p className="border-b border-[var(--line)] bg-[rgba(255,160,40,0.06)] px-3 py-1 text-[9.5px] text-[var(--amber)]">
          {fund.staleQuarters} quarter{fund.staleQuarters === 1 ? "" : "s"} behind the newest filing
          — this manager has not filed since. Treat it as a snapshot of that date, not as current.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4 px-3 py-3">
        <Donut slices={slices} />

        <div className="min-w-[180px] flex-1">
          <div className="mb-2 flex gap-1">
            {(
              [
                ["holdings", "HOLDINGS"],
                ["increased", `BOUGHT (${fund.increased.length})`],
                ["reduced", `SOLD (${fund.reduced.length})`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={cn(
                  "rounded-sm border px-2 py-0.5 text-[9.5px]",
                  tab === k
                    ? "border-[var(--amber)] text-[var(--amber)]"
                    : "border-[var(--line)] text-[var(--ink-3)]",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {fund.firstFiling && tab !== "holdings" && (
            <p className="py-2 text-[10px] text-[var(--ink-3)]">
              No prior filing to compare against, so nothing can be called a buy or a sale.
            </p>
          )}

          {rows.length === 0 && !fund.firstFiling ? (
            <p className="py-2 text-[10px] text-[var(--ink-3)]">
              Nothing in this category last quarter.
            </p>
          ) : (
            <table className="w-full text-[10.5px]">
              <tbody>
                {rows.map((p, i) => (
                  <tr key={p.issuer + p.ticker} className="border-b border-[var(--line-soft)] last:border-0">
                    <td className="w-3 py-0.5">
                      {tab === "holdings" && (
                        <span
                          className="inline-block h-2 w-2 rounded-[2px]"
                          style={{ background: COLOURS[i % COLOURS.length] }}
                        />
                      )}
                    </td>
                    <td className="max-w-[150px] truncate py-0.5 pl-1">
                      {p.ticker ? (
                        <Link href={`/ticker/${p.ticker}`} className="text-[var(--amber)] hover:underline">
                          {p.ticker}
                        </Link>
                      ) : (
                        <span className="text-[var(--ink-2)]" title={p.issuer}>
                          {p.issuer.slice(0, 20)}
                        </span>
                      )}
                    </td>
                    <td className="py-0.5 text-right tabular-nums text-[var(--ink-3)]">
                      {tab === "holdings" ? `${p.weight.toFixed(1)}%` : money(p.value)}
                    </td>
                    <td className="py-0.5 pl-3 text-right tabular-nums">
                      {tab === "holdings" ? (
                        money(p.value)
                      ) : (
                        <span className={ACTION_TONE[p.action]}>
                          {p.changeShares !== null && `${p.changeShares > 0 ? "+" : ""}${shares(p.changeShares)}`}
                        </span>
                      )}
                    </td>
                    <td className={cn("py-0.5 pl-2 text-right text-[9px]", ACTION_TONE[p.action])}>
                      {tab === "holdings" ? (p.action === "HELD" ? "" : p.action) : p.action}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="border-t border-[var(--line)] px-3 py-1.5 text-[9px] leading-snug text-[var(--ink-3)]">
        Percentages are of this manager&apos;s reported 13F table — long US equity only. Shorts,
        bonds, cash and foreign listings are not in a 13F, so this is not the whole book.
      </p>
    </section>
  );
}
