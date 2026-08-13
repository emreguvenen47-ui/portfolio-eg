"use client";

import { useState } from "react";
import { Chip } from "@/components/shell/ui";

/**
 * IC brief trigger. Click-only — nothing on the committee page reaches the
 * model without this button being pressed.
 */
interface Brief {
  summary: string;
  positioning: string;
  risks: string[];
  opportunities: string[];
  actions: string[];
  watchlist: string[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

export function IcBrief() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/ic-brief", { method: "POST" });
      const json = await res.json();
      if (json.error) setError(json.error);
      else setBrief(json.brief as Brief);
    } catch {
      setError("Brief generation failed.");
    } finally {
      setLoading(false);
    }
  }

  const lists: [keyof Brief, string][] = [
    ["risks", "Top Risks"],
    ["opportunities", "Opportunities"],
    ["actions", "Suggested Discussion Points"],
    ["watchlist", "Watch Next"],
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="rounded-sm border border-[var(--amber)] bg-[rgba(255,160,40,0.12)] px-3 py-1 text-[11px] font-medium text-[var(--amber)] disabled:opacity-50"
        >
          {loading ? "Generating…" : brief ? "Regenerate IC Brief" : "Generate IC Brief"}
        </button>
        <span className="text-[9.5px] text-[var(--ink-3)]">
          Reads the figures above; adds no data of its own.
        </span>
      </div>

      {error && <div className="px-3 py-2 text-[10.5px] text-rose-400">{error}</div>}

      {brief && (
        <div className="divide-y divide-[var(--line-soft)]">
          <div className="flex items-baseline gap-2 px-3 py-2">
            <Chip tone={brief.confidence === "HIGH" ? "pos" : brief.confidence === "LOW" ? "warn" : "neutral"}>
              {brief.confidence}
            </Chip>
            <p className="min-w-0 flex-1 text-[11px] leading-relaxed">{brief.summary}</p>
          </div>
          <div className="px-3 py-2">
            <div className="mb-0.5 text-[9.5px] uppercase tracking-wide text-[var(--ink-3)]">
              Positioning
            </div>
            <p className="text-[11px] leading-relaxed">{brief.positioning}</p>
          </div>
          {lists.map(([key, label]) => {
            const items = brief[key];
            if (!Array.isArray(items) || items.length === 0) return null;
            return (
              <div key={key} className="px-3 py-2">
                <div className="mb-0.5 text-[9.5px] uppercase tracking-wide text-[var(--ink-3)]">
                  {label}
                </div>
                <ul className="list-disc space-y-0.5 pl-4">
                  {items.map((r, i) => (
                    <li key={i} className="text-[11px] leading-relaxed">
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <div className="px-3 py-2 text-[9.5px] leading-snug text-[var(--ink-3)]">
            Generated from the computed figures on this page. Not investment advice, and no
            instruction here is executed by the application.
          </div>
        </div>
      )}
    </div>
  );
}
