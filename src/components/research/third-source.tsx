"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Ask a third source, on request.
 *
 * The rest of this page derives each ratio twice — once from the filed
 * statements, once from the provider's own figure — and marks the rows where
 * those two disagree. This resolves those rows against Google's financials.
 *
 * It is a button rather than something the page does on its own because each
 * lookup costs a credit from a fixed pool. An answer is kept for a week and
 * shared across everyone using the deployment, so a company is paid for once.
 */

interface Period {
  year: number;
  quarter: number | null;
  revenue: number | null;
  netIncome: number | null;
  eps: number | null;
  netMargin: number | null;
  totalAssets: number | null;
  totalEquity: number | null;
  ebitda: number | null;
  returnOnAssets: number | null;
  returnOnCapital: number | null;
  priceToBook: number | null;
}

interface Payload {
  fromCache: boolean;
  creditsLeft: number | null;
  data: { symbol: string; quarterly: Period[]; annual: Period[]; fetchedAt: string };
}

/** What the page already believes, so the three can be lined up. */
export interface OwnReading {
  label: string;
  /** Computed from the filed statements. */
  filed: number | null;
  /** The provider's precomputed figure. */
  reported: number | null;
  /** Which field of the third source's period answers the same question. */
  from: keyof Period;
  unit: "pct" | "x";
}

const fmt = (v: number | null, unit: "pct" | "x") =>
  v === null ? "N/A" : unit === "pct" ? `${v.toFixed(1)}%` : `${v.toFixed(2)}×`;

/** Same tolerance the server uses: proportional, with a floor. */
const agrees = (a: number | null, b: number | null) =>
  a !== null && b !== null && Math.abs(a - b) <= Math.max(1.5, Math.max(Math.abs(a), Math.abs(b)) * 0.1);

export function ThirdSource({
  symbol,
  exchange,
  readings,
}: {
  symbol: string;
  exchange: string;
  readings: OwnReading[];
}) {
  const [state, setState] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol, exchange }),
      });
      const json = (await res.json()) as Payload & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Verification failed.");
        return;
      }
      setState(json);
    } catch {
      setError("Could not reach the third source.");
    } finally {
      setBusy(false);
    }
  }

  const latest = state?.data.quarterly[0] ?? null;

  return (
    <section className="panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-1.5">
        <span className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
          Third source
        </span>
        {!state && (
          <button
            type="button"
            onClick={() => void verify()}
            disabled={busy}
            className="rounded-sm border border-[var(--amber)] px-2 py-0.5 text-[10px] text-[var(--amber)] disabled:opacity-50"
          >
            {busy ? "…" : "VERIFY AGAINST GOOGLE FINANCE"}
          </button>
        )}
        {state && (
          <span className="text-[10px] text-[var(--ink-3)]">
            {state.fromCache
              ? "from the shared cache — no credit spent"
              : `fetched · ${state.creditsLeft ?? "?"} credits left`}
          </span>
        )}
      </div>

      {error && (
        <p className="px-3 py-2 text-[10.5px] text-[var(--amber)]">{error}</p>
      )}

      {!state && !error && (
        <p className="px-3 py-2 text-[9.5px] leading-snug text-[var(--ink-3)]">
          Every ratio on this page is already derived twice. This adds a third, independent
          derivation from Google&apos;s filed financials and shows where two of the three agree.
          It costs a credit from a small pool, so it runs only when you ask — and the answer is
          then shared with everyone and kept for a week.
        </p>
      )}

      {latest && (
        <>
          <table className="w-full text-[10.5px]">
            <thead className="text-[9px] uppercase text-[var(--ink-3)]">
              <tr>
                <th className="px-3 py-1 text-left">Figure</th>
                <th className="py-1 text-right">Filings</th>
                <th className="py-1 text-right">Provider</th>
                <th className="py-1 text-right">Google</th>
                <th className="px-3 py-1 text-right">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {readings.map((r) => {
                const third = (latest[r.from] as number | null) ?? null;
                const fr = agrees(r.filed, r.reported);
                const ft = agrees(r.filed, third);
                const rt = agrees(r.reported, third);
                const majority = fr || ft || rt;
                const verdict = !majority
                  ? third === null
                    ? "no third reading"
                    : "all three differ"
                  : ft && fr
                    ? "all three agree"
                    : ft
                      ? "filings + Google"
                      : fr
                        ? "filings + provider"
                        : "provider + Google";

                return (
                  <tr key={r.label} className="border-b border-[var(--line-soft)] last:border-0">
                    <td className="px-3 py-1 text-[var(--ink-3)]">{r.label}</td>
                    <td className="py-1 text-right tabular-nums">{fmt(r.filed, r.unit)}</td>
                    <td className="py-1 text-right tabular-nums">{fmt(r.reported, r.unit)}</td>
                    <td className="py-1 text-right tabular-nums">{fmt(third, r.unit)}</td>
                    <td
                      className={cn(
                        "px-3 py-1 text-right text-[9.5px]",
                        !majority ? "text-[var(--amber)]" : "text-[var(--ink-3)]",
                      )}
                    >
                      {verdict}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-[var(--line)] px-3 py-1.5 text-[9px] leading-snug text-[var(--ink-3)]">
            Google&apos;s figures are for {latest.year}
            {latest.quarter ? ` Q${latest.quarter}` : ""}, which may not be the same period the
            other two used — a one-quarter offset is the commonest reason three readings differ.
            Nothing here is averaged: where they disagree, all three are shown and the filed
            figure is what the rest of the page reports.
          </p>
        </>
      )}
    </section>
  );
}
