"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Chip } from "@/components/shell/ui";
import { cn } from "@/lib/utils";

/**
 * Manual BUY / SELL entry for a paper portfolio.
 *
 * Looking the ticker up before submitting does two things: it refuses symbols
 * no provider can price, and it prefills the execution price with the real
 * last trade so the common case is one click rather than three fields.
 */
export function TradePanel({ id, currency }: { id: string; currency: string }) {
  const router = useRouter();
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [ticker, setTicker] = useState("");
  const [quantity, setQuantity] = useState("10");
  const [price, setPrice] = useState("");
  const [fees, setFees] = useState("0");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const lookup = async () => {
    const s = ticker.trim().toUpperCase();
    if (!s) return;
    setError(null);
    setHint(null);
    const res = await fetch(`/api/lookup?symbol=${encodeURIComponent(s)}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error === "SYMBOL NOT FOUND" ? "SYMBOL NOT FOUND" : "DATA UNAVAILABLE");
      return;
    }
    setPrice(String(json.price));
    setHint(`${json.symbol} last ${json.price} via ${json.provider}`);
  };

  const submit = async () => {
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
            ticker: ticker.trim().toUpperCase(),
            side,
            quantity: Number(quantity) || 0,
            price: Number(price) || 0,
            fees: Number(fees) || 0,
            currency,
            date,
            note,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setTicker("");
      setNote("");
      setHint(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trade failed");
    } finally {
      setBusy(false);
    }
  };

  const valid = ticker.trim() && Number(quantity) > 0 && Number(price) > 0;

  return (
    <div className="flex flex-wrap items-end gap-2 p-3">
      <div className="flex gap-1">
        {(["BUY", "SELL"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={cn(
              "rounded-sm border px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] transition-colors",
              side === s
                ? s === "BUY"
                  ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-400"
                  : "border-rose-500/60 bg-rose-500/10 text-rose-400"
                : "border-[var(--line)] text-[var(--ink-3)]",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {[
        { label: "Ticker", value: ticker, set: setTicker, w: "w-24", upper: true },
        { label: "Shares", value: quantity, set: setQuantity, w: "w-24" },
        { label: `Price (${currency})`, value: price, set: setPrice, w: "w-28" },
        { label: "Fees", value: fees, set: setFees, w: "w-20" },
      ].map((f) => (
        <label key={f.label} className="flex flex-col gap-1">
          <span className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
            {f.label}
          </span>
          <input
            value={f.value}
            onChange={(e) =>
              f.set(f.upper ? e.target.value.toUpperCase() : e.target.value.replace(/[^\d.]/g, ""))
            }
            onBlur={f.upper ? lookup : undefined}
            className={cn(
              f.w,
              "rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[11px] tabular-nums outline-none focus:border-[var(--amber)]",
            )}
          />
        </label>
      ))}

      <label className="flex flex-col gap-1">
        <span className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">Date</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[11px] outline-none focus:border-[var(--amber)]"
        />
      </label>

      <label className="flex flex-1 flex-col gap-1">
        <span className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">Note</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full min-w-[140px] rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[11px] outline-none focus:border-[var(--amber)]"
        />
      </label>

      <button
        type="button"
        onClick={submit}
        disabled={!valid || busy}
        className="rounded-sm border border-[var(--amber)] bg-[rgba(255,160,40,0.12)] px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--amber)] hover:bg-[rgba(255,160,40,0.2)] disabled:opacity-40"
      >
        {busy ? "Recording…" : `Record ${side}`}
      </button>

      {hint && <span className="text-[10px] text-[var(--ink-3)]">{hint}</span>}
      {error && <Chip tone="neg">{error}</Chip>}
    </div>
  );
}
