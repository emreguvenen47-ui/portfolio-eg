"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Empty, Note } from "@/components/shell/ui";

interface Brief {
  bullets: { topic: string; text: string }[];
  generatedAt: string;
}

const TOPIC_LABEL: Record<string, string> = {
  "portfolio-move": "Portfolio",
  "largest-contributor": "Contributor",
  "largest-detractor": "Detractor",
  "market-move": "Market",
  news: "News",
  "risk-change": "Risk",
  "thesis-warning": "Thesis",
  "to-monitor": "Monitor",
};

/**
 * Daily brief — the only AI call on the dashboard, and it fires from this
 * button alone. No effect hook, no prefetch, no regeneration on refresh.
 */
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
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-1.5">
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="rounded-sm border border-[var(--line)] px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--ink-2)] transition-colors hover:border-[var(--amber)] hover:text-[var(--amber)] disabled:opacity-50"
        >
          <Sparkles className="mr-1 inline h-3 w-3" strokeWidth={2} />
          {loading ? "Generating…" : brief ? "Regenerate" : "Generate daily brief"}
        </button>
        {brief && (
          <span className="text-[10px] text-[var(--ink-3)]">
            {new Date(brief.generatedAt).toLocaleTimeString("en-GB", { timeZone: "UTC" })} UTC
          </span>
        )}
      </div>

      {error && <p className="px-3 py-2 text-[10.5px] text-[var(--down)]">{error}</p>}

      {!brief && !error && (
        <Empty>Generated on demand only — nothing is sent to the model until you click.</Empty>
      )}

      {brief && (
        <ul className="divide-y divide-[var(--line-soft)]">
          {brief.bullets.map((b, i) => (
            <li key={`${b.topic}-${i}`} className="flex gap-2 px-3 py-1.5">
              <span className="w-[70px] shrink-0 text-[9.5px] uppercase tracking-[0.08em] text-[var(--ink-3)]">
                {TOPIC_LABEL[b.topic] ?? b.topic}
              </span>
              <span className="flex-1 text-[10.5px] leading-snug text-[var(--ink-2)]">
                {b.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
