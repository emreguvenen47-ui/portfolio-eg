"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * OPEN AS PAPER PORTFOLIO — copies a saved AI portfolio into a live paper
 * ledger ($100k, opening trades booked at current prices via the existing
 * seed-from-ai action) and jumps straight to it. One click from idea to
 * trackable ledger; the AI portfolio itself is never modified.
 */
export function SeedPaperButton({ aiPortfolioId, name }: { aiPortfolioId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const seed = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/virtual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "seed-from-ai", aiPortfolioId, name: `Paper — ${name}`.slice(0, 120) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const id = json.portfolio?.id ?? json.id;
      router.push(id ? `/virtual/${id}` : "/virtual");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  };

  return (
    <span className="ml-auto flex items-center gap-2">
      {err && <span className="max-w-[240px] truncate text-[9.5px] text-rose-400" title={err}>{err}</span>}
      <button
        type="button"
        onClick={() => void seed()}
        disabled={busy}
        className="rounded border border-emerald-500/70 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
        title="Copies this portfolio into a $100k paper ledger with opening trades at current prices"
      >
        {busy ? "Opening…" : "▶ Open as Paper Portfolio"}
      </button>
    </span>
  );
}
