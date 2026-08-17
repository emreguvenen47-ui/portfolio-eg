"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * What the tracked managers moved into and out of last quarter.
 *
 * Ranked by shares moved rather than by percentage. A manager opening a small
 * position in something illiquid is an infinite percentage and no information;
 * absolute size is what says where real money went.
 */

export interface FlowRow {
  ticker: string | null;
  issuer: string;
  cusip: string;
  buyers: string[];
  sellers: string[];
  netShares: number;
  netPct: number | null;
  value: number;
  holders: number;
  opened: number;
  closed: number;
  likelyDelisted: boolean;
}

const shares = (v: number) => {
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "+";
  return a >= 1e6 ? `${s}${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${s}${(a / 1e3).toFixed(0)}K` : `${s}${a}`;
};

const money = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v.toFixed(0)}`;

function Row({ r, side }: { r: FlowRow; side: "buy" | "sell" }) {
  const [open, setOpen] = useState(false);
  const names = side === "buy" ? r.buyers : r.sellers;

  return (
    <>
      <tr
        onClick={() => setOpen((o) => !o)}
        className="cursor-pointer border-b border-[var(--line-soft)] last:border-0 hover:bg-[var(--panel-2)]"
      >
        <td className="px-3 py-1">
          {r.ticker ? (
            <Link
              href={`/ticker/${r.ticker}`}
              onClick={(e) => e.stopPropagation()}
              className="text-[var(--amber)] hover:underline"
            >
              {r.ticker}
            </Link>
          ) : (
            <span className="text-[var(--ink-2)]" title={r.issuer}>
              {r.issuer.slice(0, 18)}
            </span>
          )}
        </td>
        <td
          className={cn(
            "py-1 text-right tabular-nums font-medium",
            side === "buy" ? "text-emerald-400" : "text-rose-400",
          )}
        >
          {shares(r.netShares)}
        </td>
        <td className="py-1 text-right tabular-nums text-[var(--ink-3)]">
          {r.netPct === null ? "new" : `${r.netPct > 0 ? "+" : ""}${r.netPct.toFixed(0)}%`}
        </td>
        <td className="py-1 text-right tabular-nums text-[var(--ink-3)]">{money(r.value)}</td>
        <td className="px-3 py-1 text-right text-[9.5px] text-[var(--ink-3)]">
          {names.length} {side === "buy" ? "buying" : "selling"}
          {side === "buy" && r.opened > 0 && ` · ${r.opened} new`}
          {side === "sell" && r.closed > 0 && ` · ${r.closed} out`}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-[var(--line-soft)] bg-[var(--panel-2)]">
          <td colSpan={5} className="px-3 py-1.5 text-[9.5px] leading-snug text-[var(--ink-3)]">
            <span className="text-[var(--ink-2)]">{r.issuer}</span> · CUSIP {r.cusip} ·{" "}
            {r.holders} of the tracked managers hold it
            <br />
            {side === "buy" ? "Bought by" : "Sold by"}: {names.join(", ") || "—"}
          </td>
        </tr>
      )}
    </>
  );
}

export function FlowTable({
  title,
  rows,
  side,
  note,
}: {
  title: string;
  rows: FlowRow[];
  side: "buy" | "sell";
  note?: string;
}) {
  return (
    <section className="panel">
      <div className="border-b border-[var(--line)] px-3 py-1.5 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-[10px] text-[var(--ink-3)]">
          Nothing to show — no manager filed both of the last two quarters.
        </p>
      ) : (
        <table className="w-full text-[10.5px]">
          <thead className="text-[9px] uppercase text-[var(--ink-3)]">
            <tr>
              <th className="px-3 py-1 text-left">Company</th>
              <th className="py-1 text-right">Net shares</th>
              <th className="py-1 text-right">vs prior</th>
              <th className="py-1 text-right">Held now</th>
              <th className="px-3 py-1 text-right">Managers</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.cusip} r={r} side={side} />
            ))}
          </tbody>
        </table>
      )}
      {note && (
        <p className="border-t border-[var(--line)] px-3 py-1.5 text-[9px] leading-snug text-[var(--ink-3)]">
          {note}
        </p>
      )}
    </section>
  );
}
