"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MACRO_TICKERS } from "@/lib/data/macro-tickers";

/**
 * TICKER TAPE — continuously scrolling macro strip (S&P, gold, silver, Brent,
 * BTC, ETH, copper, natgas). Every chip links to its full ticker page; the
 * strip duplicates its content so the CSS marquee loops seamlessly.
 */

interface TapeItem {
  alias: string;
  label: string;
  price: number | null;
  changePct: number | null;
  kind: string;
}

const DEC = new Map(MACRO_TICKERS.map((t) => [t.alias, t.decimals]));

function Cell({ it }: { it: TapeItem }) {
  const chg = it.changePct;
  return (
    <Link
      href={`/ticker/${it.alias}`}
      className="flex shrink-0 items-baseline gap-1.5 px-3 text-[10.5px] hover:bg-white/5"
      title={it.kind === "PROXY_ETF" ? `${it.label} — ETF proxy` : it.label}
    >
      <span className="font-semibold tracking-tight text-[var(--ink-2)]">{it.alias}</span>
      <span className="tabular-nums">
        {it.price === null ? "—" : it.price.toLocaleString("en-US", { maximumFractionDigits: DEC.get(it.alias) ?? 2 })}
      </span>
      <span className={`tabular-nums ${chg === null ? "text-[var(--ink-3)]" : chg >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
        {chg === null ? "" : `${chg >= 0 ? "▲" : "▼"}${Math.abs(chg).toFixed(2)}%`}
      </span>
    </Link>
  );
}

export function TickerTape() {
  const [items, setItems] = useState<TapeItem[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/tape")
        .then((r) => r.json())
        .then((j) => alive && setItems(j.items ?? []))
        .catch(() => null);
    void load();
    const t = setInterval(load, 90_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!items.length) return null;
  const strip = (
    <div className="flex items-center">
      {items.map((it) => (
        <Cell key={it.alias} it={it} />
      ))}
    </div>
  );
  return (
    <div className="relative overflow-hidden border-b border-[var(--line)] bg-black/20 py-1">
      <div className="flex w-max animate-[tape_45s_linear_infinite] hover:[animation-play-state:paused]">
        {strip}
        {strip}
      </div>
      <style>{`@keyframes tape { from { transform: translateX(0); } to { transform: translateX(-50%); } }`}</style>
    </div>
  );
}
