"use client";

import { useEffect, useMemo, useState } from "react";
import usePoll from "@/lib/use-poll";
import { StatusBadge } from "@/components/shell/ui";
import { fmtNum, fmtPctPoints, signClass } from "@/lib/format";
import type { DataStatus, Quote } from "@/lib/types";

const KEY = "pcc.watchlist";
const SEED = ["DBMF", "SGOV", "BBJP", "INDA", "TLT", "IBIT"];

export function Watchlist({ held }: { held: string[] }) {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      setSymbols(raw ? (JSON.parse(raw) as string[]) : SEED);
    } catch {
      setSymbols(SEED);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(KEY, JSON.stringify(symbols));
  }, [symbols, ready]);

  const url = symbols.length ? `/api/quotes?symbols=${symbols.join(",")}` : null;
  // Interval omitted on purpose: usePoll's default matches the server-side
  // quote cache TTL, so the watchlist refreshes in step with the rest of the app.
  const { data, loading } = usePoll<{
    quotes: Record<string, Quote>;
    status: DataStatus;
  }>(url);

  const rows = useMemo(
    () => symbols.map((s) => ({ symbol: s, quote: data?.quotes[s] ?? null })),
    [symbols, data],
  );

  const add = (raw: string) => {
    const s = raw.trim().toUpperCase();
    if (!s || symbols.includes(s)) return;
    setSymbols((prev) => [...prev, s].slice(0, 30));
    setDraft("");
  };

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-[var(--line)] p-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add(draft);
          }}
          placeholder="Add symbol (e.g. DBMF, XAU/USD)"
          className="w-56 rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[11px] outline-none focus:border-[var(--amber)]"
        />
        <button
          type="button"
          onClick={() => add(draft)}
          className="rounded-sm border border-[var(--line)] px-2 py-1 text-[11px] text-[var(--ink-2)] hover:border-[var(--amber)] hover:text-[var(--amber)]"
        >
          Add
        </button>
        {data && <StatusBadge status={data.status} />}
        {loading && <span className="text-[10px] text-[var(--ink-3)]">loading…</span>}
        <button
          type="button"
          onClick={() => setSymbols(SEED)}
          className="ml-auto text-[10px] text-[var(--ink-3)] hover:text-[var(--amber)]"
        >
          Reset
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="p-6 text-center text-[11px] text-[var(--ink-3)]">
          Watchlist is empty.
        </div>
      ) : (
        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">Symbol</th>
              <th>Last</th>
              <th>Change</th>
              <th>Daily %</th>
              <th className="tl">Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ symbol, quote }) => (
              <tr key={symbol}>
                <td className="tl font-semibold">{symbol}</td>
                <td>{quote ? fmtNum(quote.price, quote.price > 500 ? 0 : 2) : "—"}</td>
                <td className={signClass(quote?.change)}>
                  {quote ? fmtNum(quote.change, 2) : "—"}
                </td>
                <td className={signClass(quote?.changePercent)}>
                  {quote ? fmtPctPoints(quote.changePercent) : "—"}
                </td>
                <td className="tl text-[10px] text-[var(--ink-3)]">
                  {held.includes(symbol)
                    ? "held in portfolio"
                    : (quote?.fallbackReason ?? "")}
                </td>
                <td className="tl">
                  <button
                    type="button"
                    onClick={() => setSymbols((p) => p.filter((x) => x !== symbol))}
                    className="text-[12px] text-[var(--ink-3)] hover:text-[var(--down)]"
                    aria-label={`Remove ${symbol}`}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
