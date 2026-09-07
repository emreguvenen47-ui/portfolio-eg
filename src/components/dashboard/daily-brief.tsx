"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Eye,
  LineChart,
  Newspaper,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Note } from "@/components/shell/ui";

interface Brief {
  bullets: { topic: string; text: string }[];
  generatedAt: string;
}

/**
 * Daily brief — the only AI call on the dashboard, and it fires from the
 * button alone (no effect hook, no prefetch, no regeneration on refresh).
 * Each topic gets its own color rail and icon so the eye can jump straight
 * to "what hurt / what helped / what to watch".
 */

const TOPIC_META: Record<
  string,
  { label: string; color: string; Icon: typeof Wallet }
> = {
  "portfolio-move": { label: "Portfolio", color: "#f59e0b", Icon: Wallet },
  "largest-contributor": { label: "Helped", color: "#34d399", Icon: TrendingUp },
  "largest-detractor": { label: "Hurt", color: "#f87171", Icon: TrendingDown },
  "market-move": { label: "Market", color: "#60a5fa", Icon: LineChart },
  news: { label: "News", color: "#818cf8", Icon: Newspaper },
  "risk-change": { label: "Risk", color: "#fb923c", Icon: AlertTriangle },
  "thesis-warning": { label: "Thesis", color: "#fbbf24", Icon: Target },
  "to-monitor": { label: "Watch", color: "#94a3b8", Icon: Eye },
};

const FALLBACK = { label: "Note", color: "#94a3b8", Icon: Eye };

export function DailyBrief({ aiConfigured }: { aiConfigured: boolean }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/brief", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setBrief(json as Brief);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate brief");
    } finally {
      setLoading(false);
    }
  };

  if (!aiConfigured) {
    return (
      <Note tone="info">
        <span>
          Add <code className="text-[var(--amber)]">ANTHROPIC_API_KEY</code> to{" "}
          <code className="text-[var(--amber)]">.env.local</code> to enable the daily brief.
        </span>
      </Note>
    );
  }

  return (
    <div>
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <span className="flex h-6 w-6 items-center justify-center rounded bg-[var(--amber)]/15">
          <Sparkles className="h-3.5 w-3.5 text-[var(--amber)]" strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold leading-tight">Your morning in 30 seconds</div>
          <div className="text-[9px] text-[var(--ink-3)]">
            what moved, what helped, what hurt, what to watch — from your own book, on demand only
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {brief && (
            <span className="text-[9.5px] tabular-nums text-[var(--ink-3)]">
              generated {new Date(brief.generatedAt).toLocaleTimeString("en-GB", { timeZone: "UTC" }).slice(0, 5)}{" "}
              UTC
            </span>
          )}
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="rounded border border-[var(--amber)]/60 bg-[var(--amber)]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--amber)] transition-colors hover:bg-[var(--amber)]/20 disabled:opacity-50"
          >
            {loading ? "Thinking…" : brief ? "Refresh" : "Generate brief"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-3 my-2 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[10.5px] text-rose-300">
          {error}
        </div>
      )}

      {/* Skeleton while the model writes */}
      {loading && (
        <div className="flex flex-col gap-2 p-3">
          {[80, 65, 90, 55].map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="h-5 w-14 animate-pulse rounded bg-white/5" />
              <div className="h-3 animate-pulse rounded bg-white/5" style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
      )}

      {!brief && !error && !loading && (
        <div className="flex flex-col items-center gap-1 px-4 py-6 text-center">
          <span className="text-[11px] text-[var(--ink-2)]">Nothing is sent to the model until you click.</span>
          <span className="text-[9.5px] text-[var(--ink-3)]">
            One click reads your positions, yesterday&apos;s moves and risk changes, and writes the brief below.
          </span>
        </div>
      )}

      {brief && !loading && (
        <div className="grid grid-cols-1 gap-2 p-3 lg:grid-cols-2">
          {brief.bullets.map((b, i) => {
            const meta = TOPIC_META[b.topic] ?? FALLBACK;
            const Icon = meta.Icon;
            return (
              <div
                key={`${b.topic}-${i}`}
                className="flex gap-2.5 rounded border border-[var(--line)] p-2.5"
                style={{ borderLeft: `3px solid ${meta.color}` }}
              >
                <span
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded"
                  style={{ background: `${meta.color}1f` }}
                >
                  <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} strokeWidth={2} />
                </span>
                <div className="min-w-0">
                  <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: meta.color }}>
                    {meta.label}
                  </div>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--ink-1,inherit)]">{b.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
