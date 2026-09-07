"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * OPTIONS TAB — the chain around the money with the numbers a trader actually
 * uses: bid (sell to open/close), ask (buy), mark, BREAKEVEN per contract,
 * % move to breakeven, IV, delta, open interest. Plus the ATM straddle →
 * the market-implied move by each expiry.
 *
 * Source: the app's own /api/options (Yahoo public chain, delayed). Every
 * number is the venue's; breakevens are arithmetic on the shown premium
 * (long call BE = strike + ask, long put BE = strike − ask). Nothing solved
 * for, nothing invented — a strike without a two-sided quote shows N/A.
 */

interface Greeks {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
}

interface OptionQuote {
  contract: string;
  type: "CALL" | "PUT";
  strike: number;
  expiry: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  mark: number | null;
  markFrom: "MID" | "LAST" | null;
  impliedVolatility: number | null;
  openInterest: number | null;
  volume: number | null;
  inTheMoney: boolean | null;
  greeks: Greeks | null;
}

interface Chain {
  symbol: string;
  underlying: number | null;
  expiries: string[];
  expiry: string | null;
  calls: OptionQuote[];
  puts: OptionQuote[];
  fetchedAt: string;
  error?: string;
}

const f2 = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));
const pct = (v: number | null, d = 1) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);

function daysTo(expiry: string): number {
  return Math.max(0, Math.round((Date.parse(`${expiry}T21:00:00Z`) - Date.now()) / 86_400_000));
}

/** Long-side breakeven from the price you would actually PAY (ask, else mark). */
function breakeven(q: OptionQuote): { be: number | null; from: "ASK" | "MARK" | null } {
  const prem = q.ask ?? q.mark;
  if (prem === null) return { be: null, from: null };
  const be = q.type === "CALL" ? q.strike + prem : q.strike - prem;
  return { be, from: q.ask !== null ? "ASK" : "MARK" };
}

function Row({ q, underlying }: { q: OptionQuote; underlying: number | null }) {
  const { be } = breakeven(q);
  const toBe = be !== null && underlying !== null && underlying > 0 ? ((be / underlying - 1) * 100) : null;
  return (
    <tr className={q.inTheMoney ? "bg-white/[0.04]" : ""}>
      <td className="tl tabular-nums font-semibold">
        {f2(q.strike, q.strike >= 500 ? 0 : 2)}
        {q.inTheMoney ? <span className="ml-1 text-[8px] text-amber-400/80">ITM</span> : null}
      </td>
      <td className="tabular-nums text-rose-300" title="Bid — the price you SELL at">{f2(q.bid)}</td>
      <td className="tabular-nums text-emerald-300" title="Ask — the price you BUY at">{f2(q.ask)}</td>
      <td className="tabular-nums text-[var(--ink-2)]" title={q.markFrom === "LAST" ? "No two-sided quote — last trade" : "Mid of bid/ask"}>
        {f2(q.mark)}
        {q.markFrom === "LAST" ? "ᴸ" : ""}
      </td>
      <td className="tabular-nums font-semibold" title="Long breakeven at expiry, paid at the ask">
        {f2(be)}
      </td>
      <td className={`tabular-nums ${toBe === null ? "" : Math.abs(toBe) <= 3 ? "text-emerald-400" : Math.abs(toBe) <= 8 ? "text-amber-400" : "text-rose-400"}`}
          title="Move the underlying needs by expiry to break even">
        {pct(toBe)}
      </td>
      <td className="tabular-nums">{q.impliedVolatility !== null ? `${(q.impliedVolatility * 100).toFixed(0)}%` : "—"}</td>
      <td className="tabular-nums text-[var(--ink-3)]">{q.greeks?.delta != null ? q.greeks.delta.toFixed(2) : "—"}</td>
      <td className="tabular-nums text-[var(--ink-3)]">{q.openInterest ?? "—"}</td>
      <td className="tabular-nums text-[var(--ink-3)]">{q.volume ?? "—"}</td>
    </tr>
  );
}

function SideTable({ title, rows, underlying, tone }: { title: string; rows: OptionQuote[]; underlying: number | null; tone: string }) {
  return (
    <div className="min-w-0 flex-1 rounded border border-[var(--line)]">
      <div className="border-b border-[var(--line)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: tone }}>
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="grid-table w-full">
          <thead>
            <tr>
              <th className="tl">Strike</th>
              <th title="Sell price">Bid</th>
              <th title="Buy price">Ask</th>
              <th>Mark</th>
              <th>Breakeven</th>
              <th>To BE</th>
              <th>IV</th>
              <th>Δ</th>
              <th>OI</th>
              <th>Vol</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <Row key={q.contract} q={q} underlying={underlying} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OptionsTab({ symbol }: { symbol: string }) {
  const [chain, setChain] = useState<Chain | null>(null);
  const [expiry, setExpiry] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    const q = expiry ? `&expiry=${expiry}` : "";
    fetch(`/api/options?symbol=${encodeURIComponent(symbol)}${q}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.error) setErr(j.error as string);
        else setChain(j as Chain);
      })
      .catch(() => alive && setErr("Failed to load the option chain."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [symbol, expiry]);

  const view = useMemo(() => {
    if (!chain || chain.underlying === null) return null;
    const u = chain.underlying;
    const around = (rows: OptionQuote[]) => {
      const sorted = [...rows].sort((a, b) => a.strike - b.strike);
      const atmIdx = sorted.reduce((best, q, i) => (Math.abs(q.strike - u) < Math.abs(sorted[best]!.strike - u) ? i : best), 0);
      return sorted.slice(Math.max(0, atmIdx - 7), atmIdx + 8);
    };
    const calls = around(chain.calls);
    const puts = around(chain.puts);
    const atm = (rows: OptionQuote[]) =>
      rows.reduce<OptionQuote | null>((b, q) => (b === null || Math.abs(q.strike - u) < Math.abs(b.strike - u) ? q : b), null);
    const atmCall = atm(chain.calls);
    const atmPut = atm(chain.puts);
    const cPrem = atmCall ? (atmCall.ask ?? atmCall.mark) : null;
    const pPrem = atmPut ? (atmPut.ask ?? atmPut.mark) : null;
    const straddle =
      atmCall && atmPut && cPrem !== null && pPrem !== null
        ? {
            cost: cPrem + pPrem,
            upBe: atmCall.strike + cPrem + pPrem,
            downBe: atmPut.strike - cPrem - pPrem,
            movePct: ((cPrem + pPrem) / u) * 100,
          }
        : null;
    return { calls, puts, atmCall, atmPut, straddle };
  }, [chain]);

  return (
    <div className="flex flex-col gap-3" style={{ ["--tab-accent" as string]: "#2dd4bf" }}>
      {/* Expiry rail */}
      {chain && chain.expiries.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chain.expiries.slice(0, 12).map((e) => {
            const on = (chain.expiry ?? "") === e;
            return (
              <button
                key={e}
                type="button"
                onClick={() => setExpiry(e)}
                className={`rounded border px-2 py-0.5 text-[9.5px] tabular-nums ${
                  on ? "border-teal-400/70 bg-teal-500/10 text-teal-300" : "border-[var(--line)] text-[var(--ink-3)] hover:text-[var(--ink-1,inherit)]"
                }`}
              >
                {e} · {daysTo(e)}d
              </button>
            );
          })}
        </div>
      )}

      {loading && <div className="rounded border border-[var(--line)] p-4 text-[11px] text-[var(--ink-3)]">Loading option chain…</div>}
      {err && !loading && (
        <div className="rounded border border-[var(--line)] p-4 text-[11px] text-[var(--ink-3)]">
          {err} Options exist only for optionable US listings; nothing is synthesized when the venue lists none.
        </div>
      )}

      {chain && view && !loading && !err && (
        <>
          {/* Implied move / straddle strip */}
          <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] rounded border border-[var(--line)] sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
            {[
              ["Underlying", f2(chain.underlying), ""],
              ["Expiry", `${chain.expiry ?? "—"} (${chain.expiry ? daysTo(chain.expiry) + "d" : ""})`, ""],
              ["ATM straddle cost", view.straddle ? `$${f2(view.straddle.cost)}` : "N/A", "buy call + put at the money (ask)"],
              ["Implied move", view.straddle ? `±${view.straddle.movePct.toFixed(1)}%` : "N/A", "what the market charges for this expiry"],
              ["Upside breakeven", view.straddle ? f2(view.straddle.upBe) : "N/A", "straddle profits above here"],
              ["Downside breakeven", view.straddle ? f2(view.straddle.downBe) : "N/A", "straddle profits below here"],
            ].map(([k, v, sub]) => (
              <div key={k as string} className="px-3 py-1.5">
                <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">{k}</div>
                <div className="text-[12.5px] font-semibold tabular-nums text-teal-300">{v}</div>
                {sub ? <div className="text-[8.5px] text-[var(--ink-3)]">{sub}</div> : null}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 xl:flex-row">
            <SideTable title={`Calls — long BE = strike + premium`} rows={view.calls} underlying={chain.underlying} tone="#34d399" />
            <SideTable title={`Puts — long BE = strike − premium`} rows={view.puts} underlying={chain.underlying} tone="#f87171" />
          </div>

          <p className="text-[9.5px] leading-snug text-[var(--ink-3)]">
            Bid = the price you sell at, Ask = the price you buy at; delayed public chain (Yahoo), mark is the
            mid when two-sided (ᴸ = stale last trade). Breakevens are AT EXPIRY for a long position paid at the
            ask — before expiry, P&L follows the greeks. Rows highlighted are in the money. Fetched{" "}
            {chain.fetchedAt.slice(11, 16)} UTC.
          </p>
        </>
      )}
    </div>
  );
}
