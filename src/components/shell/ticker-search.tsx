"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface Result {
  symbol: string;
  description: string;
  type: string;
  kind?: "US STOCK" | "BIST" | "ETF" | "INDEX";
}

/**
 * Global symbol search, mounted in the header so any ticker is one keystroke
 * away from anywhere in the app — not just the ones in the workbook.
 *
 * Debounced so typing a five-letter ticker is one request, not five.
 */
export function TickerSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 1) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
        const json = await res.json();
        setResults(json.results ?? []);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const go = (symbol: string) => {
    setOpen(false);
    setQ("");
    router.push(`/ticker/${encodeURIComponent(symbol)}`);
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-1 rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-0.5 focus-within:border-[var(--amber)]">
        <Search className="h-3 w-3 shrink-0 text-[var(--ink-3)]" strokeWidth={2} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={(e) => {
            // Enter on a bare ticker goes straight there — the search index is
            // a convenience, not a gate on symbols it happens not to list.
            if (e.key === "Enter" && q.trim()) go(results[0]?.symbol ?? q.trim().toUpperCase());
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search ticker or company"
          className="w-40 bg-transparent py-0.5 text-[11px] outline-none placeholder:text-[var(--ink-3)] md:w-52"
        />
      </div>

      {open && (results.length > 0 || loading) && (
        <div className="absolute right-0 top-full z-50 mt-1 max-h-[320px] w-[300px] overflow-y-auto border border-[var(--line)] bg-[var(--panel)] shadow-lg">
          {loading && results.length === 0 ? (
            <div className="px-3 py-2 text-[10px] text-[var(--ink-3)]">Searching…</div>
          ) : (
            results.map((r) => (
              <button
                key={r.symbol}
                type="button"
                onClick={() => go(r.symbol)}
                className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-[var(--panel-2)]"
              >
                <span className="w-[64px] shrink-0 text-[11px] font-semibold">{r.symbol}</span>
                <span
                  className={cn(
                    "w-[62px] shrink-0 rounded-sm border px-1 py-px text-center text-[8.5px] tracking-wide",
                    r.kind === "BIST"
                      ? "border-[var(--amber)]/40 text-[var(--amber)]"
                      : r.kind === "ETF"
                        ? "border-sky-500/40 text-sky-400"
                        : r.kind === "INDEX"
                          ? "border-violet-500/40 text-violet-400"
                          : "border-[var(--line)] text-[var(--ink-3)]",
                  )}
                >
                  {r.kind ?? "—"}
                </span>
                <span className="flex-1 truncate text-[10px] text-[var(--ink-3)]">
                  {r.description}
                </span>
                <span className="shrink-0 text-[9px] uppercase text-[var(--ink-3)]">
                  {r.type.replace("Common Stock", "Stock")}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
