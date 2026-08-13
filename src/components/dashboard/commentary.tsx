"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Empty, Note } from "@/components/shell/ui";

interface Commentary {
  headline: string;
  allocation: string;
  concentration: string;
  diversification: string;
  currency: string;
  themes: string;
  overlaps: string[];
  strongest: string[];
  weakest: string[];
  risks: string[];
  ideas: string[];
  generatedAt: string;
}

/** Portfolio commentary. One AI call, fired from this button and nowhere else. */
export function PortfolioCommentary({ aiConfigured }: { aiConfigured: boolean }) {
  const [data, setData] = useState<Commentary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/commentary", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json as Commentary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  if (!aiConfigured) {
    return (
      <Note tone="info">
        <span>
          Add <code className="text-[var(--amber)]">ANTHROPIC_API_KEY</code> to enable portfolio
          commentary.
        </span>
      </Note>
    );
  }

  const prose: [string, string][] = data
    ? [
        ["Allocation", data.allocation],
        ["Concentration", data.concentration],
        ["Diversification", data.diversification],
        ["Currency", data.currency],
        ["Themes", data.themes],
      ]
    : [];

  const lists: [string, string[]][] = data
    ? [
        ["Overlapping exposure", data.overlaps],
        ["Strongest areas", data.strongest],
        ["Weakest areas", data.weakest],
        ["Main risks", data.risks],
        ["Improvement ideas", data.ideas],
      ]
    : [];

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-1.5">
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="rounded-sm border border-[var(--line)] px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--ink-2)] hover:border-[var(--amber)] hover:text-[var(--amber)] disabled:opacity-50"
        >
          <Sparkles className="mr-1 inline h-3 w-3" strokeWidth={2} />
          {loading ? "Analyzing…" : data ? "Re-analyze" : "Analyze portfolio"}
        </button>
        {data && (
          <span className="text-[10px] text-[var(--ink-3)]">
            {new Date(data.generatedAt).toLocaleTimeString("en-GB", { timeZone: "UTC" })} UTC
          </span>
        )}
      </div>

      {error && <p className="px-3 py-2 text-[10.5px] text-[var(--down)]">{error}</p>}

      {!data && !error && (
        <Empty>Nothing is sent to the model until you click. Structure only — no price history.</Empty>
      )}

      {data && (
        <div>
          <div className="border-b border-[var(--line)] px-3 py-2 text-[11px] font-semibold">
            {data.headline}
          </div>
          <div className="grid grid-cols-1 divide-y divide-[var(--line-soft)] lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            <div className="divide-y divide-[var(--line-soft)]">
              {prose.map(([label, text]) => (
                <div key={label} className="px-3 py-1.5">
                  <div className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                    {label}
                  </div>
                  <p className="mt-0.5 text-[10.5px] leading-snug text-[var(--ink-2)]">{text}</p>
                </div>
              ))}
            </div>
            <div className="divide-y divide-[var(--line-soft)]">
              {lists.map(([label, items]) => (
                <div key={label} className="px-3 py-1.5">
                  <div className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                    {label}
                  </div>
                  <ul className="mt-0.5 space-y-0.5">
                    {items.length === 0 ? (
                      <li className="text-[10px] text-[var(--ink-3)]">none identified</li>
                    ) : (
                      items.map((x) => (
                        <li key={x} className="text-[10.5px] leading-snug text-[var(--ink-2)]">
                          · {x}
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
