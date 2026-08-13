"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Chip, Note } from "@/components/shell/ui";
import { cn } from "@/lib/utils";
import type { SavedPosition } from "@/lib/server/ai-portfolios";

const ROLES = [
  "CORE",
  "GROWTH",
  "DEFENSIVE",
  "INCOME",
  "HEDGE",
  "DIVERSIFIER",
  "LIQUIDITY",
] as const;

interface Lookup {
  symbol: string;
  price: number;
  changePercent: number;
  currency: string;
  provider: string;
  status: string;
  hasHistory: boolean;
}

/**
 * Manual editing for a saved portfolio.
 *
 * Every action here is arithmetic plus one market-data lookup — no model call
 * on any path, which is why adding a ticker resolves through `/api/lookup`
 * rather than asking anything to classify it.
 *
 * Weights are edited as percentages because that is how they are read; the
 * conversion to fractions happens once, on save.
 */
export function PortfolioEditor({
  id,
  name: initialName,
  positions: initialPositions,
}: {
  id: string;
  name: string;
  positions: SavedPosition[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [rows, setRows] = useState<SavedPosition[]>(initialPositions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [newTicker, setNewTicker] = useState("");
  const [newWeight, setNewWeight] = useState("5");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  const totalPct = useMemo(
    () => rows.reduce((s, r) => s + r.weight, 0) * 100,
    [rows],
  );
  // Exactly 100 to one hundredth of a point — the tolerance the API enforces.
  const exact = Math.abs(totalPct - 100) < 0.005;

  const patch = (ticker: string, next: Partial<SavedPosition>) =>
    setRows((cur) => cur.map((r) => (r.ticker === ticker ? { ...r, ...next } : r)));

  const remove = (ticker: string) =>
    setRows((cur) => cur.filter((r) => r.ticker !== ticker));

  const addPosition = async () => {
    const symbol = newTicker.trim().toUpperCase();
    if (!symbol) return;
    if (rows.some((r) => r.ticker === symbol)) {
      setLookupError(`${symbol} is already in this portfolio`);
      return;
    }

    setLooking(true);
    setLookupError(null);
    try {
      const res = await fetch(`/api/lookup?symbol=${encodeURIComponent(symbol)}`);
      const json = (await res.json()) as Lookup & { error?: string };
      if (!res.ok) {
        // No placeholder row: a symbol we cannot price does not get added.
        setLookupError(json.error === "SYMBOL NOT FOUND" ? "SYMBOL NOT FOUND" : "DATA UNAVAILABLE");
        return;
      }

      const weight = Math.max(0, Number(newWeight) || 0) / 100;
      setRows((cur) => [
        ...cur,
        {
          ticker: json.symbol,
          name: json.symbol,
          weight,
          originalWeight: null,
          assetClass: "Equity",
          region: "Global",
          role: "CORE",
          reason: `Added manually at ${json.price.toFixed(2)} ${json.currency} (${json.provider}).`,
          source: "manual",
          addedAt: new Date().toISOString(),
        },
      ]);
      setNewTicker("");
      setMessage(
        `${json.symbol} priced at ${json.price.toFixed(2)} via ${json.provider}` +
          (json.hasHistory ? "" : " — no price history yet, so it cannot be charted"),
      );
    } catch {
      setLookupError("DATA UNAVAILABLE");
    } finally {
      setLooking(false);
    }
  };

  const save = async (normalize: boolean) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (name !== initialName) {
        await fetch("/api/ai/portfolios", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "rename", id, name }),
        });
      }

      const res = await fetch("/api/ai/portfolios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "update",
          id,
          positions: rows,
          normalize,
          note: normalize ? "manual edit (normalised)" : "manual edit",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);

      setMessage("Saved. Performance uses the new allocation from now onward.");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const remove_ = async () => {
    if (!window.confirm(`Delete "${initialName}"? This cannot be undone.`)) return;
    await fetch("/api/ai/portfolios", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    router.push("/ai-builder");
    router.refresh();
  };

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-sm border border-[var(--amber)] bg-[rgba(255,160,40,0.12)] px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--amber)] hover:bg-[rgba(255,160,40,0.2)]"
        >
          Edit portfolio
        </button>
        <Link
          href={`/performance?portfolio=${id}`}
          className="rounded-sm border border-[var(--line)] px-3 py-1 text-[10.5px] uppercase tracking-[0.08em] text-[var(--ink-2)] hover:border-[var(--amber)] hover:text-[var(--amber)]"
        >
          Compare
        </Link>
        <button
          type="button"
          onClick={remove_}
          className="rounded-sm border border-[var(--line)] px-3 py-1 text-[10.5px] uppercase tracking-[0.08em] text-[var(--ink-3)] hover:border-[var(--down)] hover:text-[var(--down)]"
        >
          Delete
        </button>
        {message && <span className="text-[10px] text-[var(--up)]">{message}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Note tone="info">
        <span>
          Manual edits cost no AI tokens. Saving appends a new allocation with today&apos;s
          timestamp — past performance keeps the weights it was actually earned with.
        </span>
      </Note>

      <div className="flex flex-wrap items-end gap-3 border-b border-[var(--line)] pb-3">
        <label className="flex flex-col gap-1">
          <span className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
            Portfolio name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-64 rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[11px] outline-none focus:border-[var(--amber)]"
          />
        </label>
      </div>

      {/* --------------------------------------------------------- add row */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
            Enter ticker
          </span>
          <input
            value={newTicker}
            onChange={(e) => {
              setNewTicker(e.target.value.toUpperCase());
              setLookupError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addPosition();
            }}
            placeholder="AVUV"
            className="w-32 rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[11px] uppercase outline-none focus:border-[var(--amber)]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
            Weight %
          </span>
          <input
            value={newWeight}
            onChange={(e) => setNewWeight(e.target.value.replace(/[^\d.]/g, ""))}
            inputMode="decimal"
            className="w-20 rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[11px] tabular-nums outline-none focus:border-[var(--amber)]"
          />
        </label>
        <button
          type="button"
          onClick={addPosition}
          disabled={looking}
          className="rounded-sm border border-[var(--line)] px-3 py-1 text-[10.5px] uppercase tracking-[0.08em] text-[var(--ink-2)] hover:border-[var(--amber)] hover:text-[var(--amber)] disabled:opacity-50"
        >
          {looking ? "Looking up…" : "Add position"}
        </button>
        {lookupError && (
          <Chip tone="neg">{lookupError}</Chip>
        )}
      </div>

      {/* ------------------------------------------------------ edit table */}
      <div className="overflow-x-auto">
        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">Ticker</th>
              <th className="tl">Origin</th>
              <th>Original</th>
              <th>Weight %</th>
              <th className="tl">Role</th>
              <th className="tl">Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ticker}>
                <td className="tl font-semibold">{r.ticker}</td>
                <td className="tl">
                  <Chip tone={r.source === "ai" ? "info" : "amber"}>
                    {r.source === "ai" ? "AI GENERATED" : "MANUALLY ADDED"}
                  </Chip>
                </td>
                <td className="tabular-nums text-[var(--ink-3)]">
                  {r.originalWeight === null ? "—" : `${(r.originalWeight * 100).toFixed(1)}%`}
                </td>
                <td>
                  <input
                    value={(r.weight * 100).toFixed(2).replace(/\.00$/, "")}
                    onChange={(e) =>
                      patch(r.ticker, {
                        weight: Math.max(0, Number(e.target.value.replace(/[^\d.]/g, "")) || 0) / 100,
                      })
                    }
                    inputMode="decimal"
                    className="w-20 rounded-sm border border-[var(--line)] bg-[var(--bg)] px-1.5 py-0.5 text-right text-[11px] tabular-nums outline-none focus:border-[var(--amber)]"
                  />
                </td>
                <td className="tl">
                  <select
                    value={r.role}
                    onChange={(e) => patch(r.ticker, { role: e.target.value as SavedPosition["role"] })}
                    className="rounded-sm border border-[var(--line)] bg-[var(--bg)] px-1 py-0.5 text-[10.5px] outline-none focus:border-[var(--amber)]"
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="tl">
                  <input
                    value={r.reason}
                    onChange={(e) => patch(r.ticker, { reason: e.target.value })}
                    className="w-full min-w-[220px] rounded-sm border border-[var(--line)] bg-[var(--bg)] px-1.5 py-0.5 text-[10.5px] outline-none focus:border-[var(--amber)]"
                  />
                </td>
                <td className="tl">
                  <button
                    type="button"
                    onClick={() => remove(r.ticker)}
                    aria-label={`Remove ${r.ticker}`}
                    className="text-[12px] text-[var(--ink-3)] hover:text-[var(--down)]"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ------------------------------------------------------- save bar */}
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-3">
        <span
          className={cn(
            "text-[11px] font-semibold tabular-nums",
            exact ? "text-[var(--up)]" : "text-[var(--warn)]",
          )}
        >
          Current Total: {totalPct.toFixed(2)}%
        </span>
        <button
          type="button"
          onClick={() => save(false)}
          disabled={!exact || busy || rows.length === 0}
          title={exact ? undefined : "Only available when the total is exactly 100%"}
          className="rounded-sm border border-[var(--line)] px-3 py-1 text-[10.5px] uppercase tracking-[0.08em] text-[var(--ink-2)] hover:border-[var(--amber)] hover:text-[var(--amber)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save as entered
        </button>
        <button
          type="button"
          onClick={() => save(true)}
          disabled={busy || rows.length === 0}
          className="rounded-sm border border-[var(--amber)] bg-[rgba(255,160,40,0.12)] px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--amber)] hover:bg-[rgba(255,160,40,0.2)] disabled:opacity-40"
        >
          Normalize to 100%
        </button>
        <button
          type="button"
          onClick={() => {
            setRows(initialPositions);
            setName(initialName);
            setOpen(false);
            setError(null);
          }}
          className="text-[10.5px] text-[var(--ink-3)] hover:text-[var(--ink)]"
        >
          Cancel
        </button>
        {error && <span className="text-[10.5px] text-[var(--down)]">{error}</span>}
        {message && <span className="text-[10.5px] text-[var(--up)]">{message}</span>}
      </div>
    </div>
  );
}
