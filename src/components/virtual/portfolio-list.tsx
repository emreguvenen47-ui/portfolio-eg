"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Empty } from "@/components/shell/ui";

interface Row {
  id: string;
  name: string;
  currency: string;
  initialCash: number;
  createdAt: string;
  trades: unknown[];
  sourceAiPortfolioId?: string;
}

/** Create, seed and manage paper portfolios. No model call on any path. */
export function VirtualPortfolioList({
  aiPortfolios,
}: {
  aiPortfolios: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState("");
  const [cash, setCash] = useState("100000");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch("/api/virtual");
    const json = await res.json();
    setRows(json.portfolios ?? []);
  };

  useEffect(() => {
    void load();
  }, []);

  const post = async (body: unknown) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/virtual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (json.skipped) setMsg(`${json.skipped} position(s) could not be priced and were skipped`);
      await load();
      router.refresh();
      return json;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2 border-b border-[var(--line)] p-3">
        <label className="flex flex-col gap-1">
          <span className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
            New portfolio
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Paper Book"
            className="w-48 rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[11px] outline-none focus:border-[var(--amber)]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
            Starting cash
          </span>
          <input
            value={cash}
            onChange={(e) => setCash(e.target.value.replace(/[^\d]/g, ""))}
            className="w-32 rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[11px] tabular-nums outline-none focus:border-[var(--amber)]"
          />
        </label>
        <button
          type="button"
          disabled={!name.trim() || busy}
          onClick={() =>
            post({ action: "create", name: name.trim(), initialCash: Number(cash) || 0 }).then(() =>
              setName(""),
            )
          }
          className="rounded-sm border border-[var(--amber)] bg-[rgba(255,160,40,0.12)] px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--amber)] hover:bg-[rgba(255,160,40,0.2)] disabled:opacity-40"
        >
          Create
        </button>

        {aiPortfolios.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
              Or track a saved AI portfolio
            </span>
            <select
              defaultValue=""
              disabled={busy}
              onChange={(e) => {
                if (!e.target.value) return;
                void post({ action: "seed-from-ai", aiPortfolioId: e.target.value });
                e.target.value = "";
              }}
              className="rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[11px] outline-none focus:border-[var(--amber)]"
            >
              <option value="">Seed as paper portfolio…</option>
              {aiPortfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {msg && <span className="text-[10px] text-[var(--warn)]">{msg}</span>}
      </div>

      {rows.length === 0 ? (
        <Empty>No paper portfolios yet.</Empty>
      ) : (
        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">Name</th>
              <th>Trades</th>
              <th>Deposited</th>
              <th className="tl">Created</th>
              <th className="tl">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="tl font-semibold">
                  <Link href={`/virtual/${p.id}`} className="hover:text-[var(--amber)]">
                    {p.name}
                  </Link>
                  {p.sourceAiPortfolioId && (
                    <span className="ml-2 text-[9px] uppercase text-[var(--ink-3)]">from AI</span>
                  )}
                </td>
                <td className="tabular-nums">{p.trades.length}</td>
                <td className="tabular-nums">
                  {new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: p.currency,
                    maximumFractionDigits: 0,
                  }).format(p.initialCash)}
                </td>
                <td className="tl text-[10px] text-[var(--ink-3)]">
                  {new Date(p.createdAt).toLocaleDateString("en-GB")}
                </td>
                <td className="tl">
                  <div className="flex gap-2 text-[10px]">
                    <Link
                      href={`/virtual/${p.id}`}
                      className="text-[var(--ink-3)] hover:text-[var(--amber)]"
                    >
                      open
                    </Link>
                    <Link
                      href={`/performance?portfolio=v:${p.id}`}
                      className="text-[var(--ink-3)] hover:text-[var(--amber)]"
                    >
                      performance
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        const n = window.prompt("New name", p.name);
                        if (n?.trim()) void post({ action: "rename", id: p.id, name: n.trim() });
                      }}
                      className="text-[var(--ink-3)] hover:text-[var(--amber)]"
                    >
                      rename
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete "${p.name}"?`))
                          void post({ action: "delete", id: p.id });
                      }}
                      className="text-[var(--ink-3)] hover:text-[var(--down)]"
                    >
                      delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
