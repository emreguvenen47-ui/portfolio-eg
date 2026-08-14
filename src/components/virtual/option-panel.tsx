"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Option entry for a paper portfolio.
 *
 * You pick a real contract off a real chain rather than typing a strike: the
 * premium, the multiplier and the expiry all come from the venue's own listing,
 * so a ledger entry cannot describe a contract that does not exist.
 *
 * The premium is prefilled from the chain's mark — the mid of a two-sided
 * quote, or the last trade when there is no quote. Which one it used is stated,
 * because a strike nobody has dealt today can print a last trade that is hours
 * old, and filling that in silently would put a stale number in a ledger.
 */

interface Quote {
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
}

interface Chain {
  symbol: string;
  underlying: number | null;
  expiries: string[];
  expiry: string | null;
  calls: Quote[];
  puts: Quote[];
  error?: string;
}

const money = (v: number | null) => (v === null ? "—" : v.toFixed(2));
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(0)}%`);

export function OptionPanel({ id, currency }: { id: string; currency: string }) {
  const router = useRouter();
  const [symbol, setSymbol] = useState("");
  const [chain, setChain] = useState<Chain | null>(null);
  const [expiry, setExpiry] = useState<string>("");
  const [type, setType] = useState<"CALL" | "PUT">("CALL");
  const [picked, setPicked] = useState<Quote | null>(null);
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [contracts, setContracts] = useState("1");
  const [premium, setPremium] = useState("");
  const [fees, setFees] = useState("0");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadChain(sym: string, exp?: string) {
    const s = sym.trim().toUpperCase();
    if (!s) return;
    setBusy(true);
    setError(null);
    setPicked(null);
    try {
      const url = `/api/options?symbol=${encodeURIComponent(s)}${exp ? `&expiry=${exp}` : ""}`;
      const res = await fetch(url);
      const json = (await res.json()) as Chain;
      if (!res.ok) {
        setChain(null);
        setError(json.error ?? "No chain available for this symbol.");
        return;
      }
      setChain(json);
      setExpiry(json.expiry ?? "");
    } catch {
      setChain(null);
      setError("Could not reach the option chain.");
    } finally {
      setBusy(false);
    }
  }

  function pick(q: Quote) {
    setPicked(q);
    // Prefill from the mark, but leave it editable: a paper fill is your
    // assumption about where you would have dealt, not ours.
    setPremium(q.mark === null ? "" : q.mark.toFixed(2));
  }

  async function submit() {
    if (!picked || !chain) return;
    const qty = Number(contracts);
    const px = Number(premium);
    if (!Number.isFinite(qty) || qty <= 0) return setError("Enter a contract count.");
    if (!Number.isFinite(px) || px <= 0) return setError("Enter a premium per share.");

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/virtual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "trade",
          id,
          trade: {
            ticker: chain.symbol,
            side,
            quantity: qty,
            // Premium per share, exactly as the chain quotes it. The
            // multiplier below turns it into cash.
            price: px,
            fees: Number(fees) || 0,
            currency,
            date,
            note: `${picked.type} ${picked.strike} ${picked.expiry}`,
            option: {
              contract: picked.contract,
              type: picked.type,
              strike: picked.strike,
              expiry: picked.expiry,
              multiplier: 100,
            },
          },
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Could not record the trade.");
        return;
      }
      setPicked(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const rows = (chain ? (type === "CALL" ? chain.calls : chain.puts) : []).filter(
    (q) => q.mark !== null,
  );

  const cash =
    picked && Number(contracts) > 0 && Number(premium) > 0
      ? Number(contracts) * Number(premium) * 100
      : null;

  return (
    <section className="panel">
      <div className="border-b border-[var(--line)] px-3 py-1.5 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
        Options
      </div>

      <div className="flex flex-wrap items-end gap-2 px-3 py-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase text-[var(--ink-3)]">Underlying</span>
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadChain(symbol)}
            placeholder="AAPL"
            className="w-24 rounded-sm border border-[var(--line)] bg-transparent px-2 py-1 text-[11px] uppercase outline-none focus:border-[var(--amber)]"
          />
        </label>
        <button
          type="button"
          onClick={() => loadChain(symbol)}
          disabled={busy}
          className="rounded-sm border border-[var(--line)] px-2 py-1 text-[10px] text-[var(--ink-2)] disabled:opacity-50"
        >
          {busy ? "…" : "LOAD CHAIN"}
        </button>

        {chain && (
          <>
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase text-[var(--ink-3)]">Expiry</span>
              <select
                value={expiry}
                onChange={(e) => {
                  setExpiry(e.target.value);
                  void loadChain(chain.symbol, e.target.value);
                }}
                className="rounded-sm border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-[11px] outline-none"
              >
                {chain.expiries.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex gap-1">
              {(["CALL", "PUT"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn(
                    "rounded-sm border px-2 py-1 text-[10px]",
                    type === t
                      ? "border-[var(--amber)] text-[var(--amber)]"
                      : "border-[var(--line)] text-[var(--ink-3)]",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>

            <span className="text-[10px] text-[var(--ink-3)]">
              underlying {money(chain.underlying)}
            </span>
          </>
        )}
      </div>

      {error && (
        <p className="border-t border-[var(--line)] px-3 py-1.5 text-[10px] text-[var(--amber)]">
          {error}
        </p>
      )}

      {chain && rows.length > 0 && (
        <div className="max-h-[260px] overflow-y-auto border-t border-[var(--line)]">
          <table className="w-full text-[10.5px]">
            <thead className="sticky top-0 bg-[var(--panel)] text-[9px] uppercase text-[var(--ink-3)]">
              <tr>
                <th className="px-3 py-1 text-left">Strike</th>
                <th className="py-1 text-right">Bid</th>
                <th className="py-1 text-right">Ask</th>
                <th className="py-1 text-right">Mark</th>
                <th className="py-1 text-right">IV</th>
                <th className="py-1 text-right">OI</th>
                <th className="px-3 py-1 text-right">Src</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => (
                <tr
                  key={q.contract}
                  onClick={() => pick(q)}
                  className={cn(
                    "cursor-pointer border-b border-[var(--line-soft)] last:border-0 hover:bg-[var(--panel-2)]",
                    picked?.contract === q.contract && "bg-[var(--panel-2)]",
                  )}
                >
                  <td className="px-3 py-1 tabular-nums">
                    {q.strike}
                    {q.inTheMoney && (
                      <span className="ml-1 text-[8.5px] text-[var(--ink-3)]">itm</span>
                    )}
                  </td>
                  <td className="py-1 text-right tabular-nums">{money(q.bid)}</td>
                  <td className="py-1 text-right tabular-nums">{money(q.ask)}</td>
                  <td className="py-1 text-right tabular-nums font-medium">{money(q.mark)}</td>
                  <td className="py-1 text-right tabular-nums">{pct(q.impliedVolatility)}</td>
                  <td className="py-1 text-right tabular-nums">{q.openInterest ?? "—"}</td>
                  <td
                    className={cn(
                      "px-3 py-1 text-right text-[9px]",
                      q.markFrom === "LAST" ? "text-[var(--amber)]" : "text-[var(--ink-3)]",
                    )}
                    title={
                      q.markFrom === "LAST"
                        ? "No two-sided quote — this is the last trade, which may be stale."
                        : "Mid of the bid and ask."
                    }
                  >
                    {q.markFrom ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {picked && (
        <div className="flex flex-wrap items-end gap-2 border-t border-[var(--line)] px-3 py-2">
          <div className="flex gap-1">
            {(["BUY", "SELL"] as const).map((sd) => (
              <button
                key={sd}
                type="button"
                onClick={() => setSide(sd)}
                className={cn(
                  "rounded-sm border px-2 py-1 text-[10px]",
                  side === sd
                    ? "border-[var(--amber)] text-[var(--amber)]"
                    : "border-[var(--line)] text-[var(--ink-3)]",
                )}
              >
                {sd}
              </button>
            ))}
          </div>

          <Field label="Contracts" value={contracts} onChange={setContracts} width="w-16" />
          <Field label="Premium /sh" value={premium} onChange={setPremium} width="w-20" />
          <Field label="Fees" value={fees} onChange={setFees} width="w-16" />
          <Field label="Date" value={date} onChange={setDate} width="w-28" type="date" />

          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-sm border border-[var(--amber)] bg-[rgba(255,160,40,0.12)] px-3 py-1 text-[10.5px] font-medium text-[var(--amber)] disabled:opacity-50"
          >
            {busy ? "…" : `${side} ${picked.type} ${picked.strike}`}
          </button>

          <span className="text-[10px] text-[var(--ink-3)]">
            {picked.contract}
            {cash !== null && ` · ${side === "BUY" ? "costs" : "credits"} ${cash.toFixed(0)} ${currency}`}
            {" · ×100 per contract"}
          </span>
        </div>
      )}

      <p className="border-t border-[var(--line)] px-3 py-1.5 text-[9px] leading-snug text-[var(--ink-3)]">
        Contracts come from the venue&apos;s listed chain, so a position cannot describe a strike
        that does not exist. Premium is quoted per share and multiplied by 100 for cash, the way
        the contract settles. A row marked LAST has no live two-sided quote — that price may be
        hours old. Paper only: nothing here places an order.
      </p>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  width,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  width: string;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase text-[var(--ink-3)]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          width,
          "rounded-sm border border-[var(--line)] bg-transparent px-2 py-1 text-[11px] outline-none focus:border-[var(--amber)]",
        )}
      />
    </label>
  );
}
