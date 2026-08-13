"use client";

import { useState } from "react";
import { Chip } from "@/components/shell/ui";
import { cn } from "@/lib/utils";

/**
 * Executive brief trigger.
 *
 * Click-only by construction: there is no effect, no poll and no prefetch that
 * could reach the endpoint. The button is the single path to a model call on
 * this page.
 */

interface Source {
  claim: string;
  basis: "FACT" | "SOURCE-DERIVED VIEW" | "AI INFERENCE";
  detail: string;
}

interface Brief {
  executiveView: string;
  investmentCase: string;
  fundamentals: string;
  valuation: string;
  smartMoney: string;
  ownership: string;
  catalysts: string;
  macroContext: string;
  bullCase: string;
  baseCase: string;
  bearCase: string;
  topRisks: string[];
  portfolioFit: string;
  bottomLine: string;
  sources: Source[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
  confidenceReason: string;
}

const BASIS_TONE = {
  FACT: "pos",
  "SOURCE-DERIVED VIEW": "neutral",
  "AI INFERENCE": "warn",
} as const;

const SECTIONS: [keyof Brief, string][] = [
  ["executiveView", "Executive View"],
  ["investmentCase", "Investment Case"],
  ["fundamentals", "Fundamentals"],
  ["valuation", "Valuation"],
  ["smartMoney", "Smart Money"],
  ["ownership", "Insiders / Ownership"],
  ["catalysts", "Catalysts"],
  ["macroContext", "Macro Context"],
  ["bullCase", "Bull Case"],
  ["baseCase", "Base Case"],
  ["bearCase", "Bear Case"],
  ["portfolioFit", "Portfolio Fit"],
  ["bottomLine", "Bottom Line"],
];

export function ExecutiveBrief({ symbol }: { symbol: string }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/executive-brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const json = await res.json();
      if (json.error) setError(json.error);
      else {
        setBrief(json.brief as Brief);
        setAt(json.generatedAt as string);
      }
    } catch {
      setError("Brief generation failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="rounded-sm border border-[var(--amber)] bg-[rgba(255,160,40,0.12)] px-3 py-1 text-[11px] font-medium text-[var(--amber)] disabled:opacity-50"
        >
          {loading ? "Generating…" : brief ? "Regenerate" : "Generate Executive Brief"}
        </button>
        <span className="text-[9.5px] leading-snug text-[var(--ink-3)]">
          The only model call on this page. Nothing here runs automatically, and no price or
          research figure elsewhere on the page is produced by AI.
        </span>
        {at && (
          <span className="ml-auto text-[9.5px] text-[var(--ink-3)]">
            {at.slice(0, 16).replace("T", " ")}
          </span>
        )}
      </div>

      {error && (
        <div className="px-3 py-2 text-[10.5px] text-rose-400">{error}</div>
      )}

      {brief && (
        <div className="divide-y divide-[var(--line-soft)]">
          <div className="flex items-baseline gap-2 px-3 py-2">
            <span className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
              Confidence
            </span>
            <Chip
              tone={
                brief.confidence === "HIGH" ? "pos" : brief.confidence === "LOW" ? "warn" : "neutral"
              }
            >
              {brief.confidence}
            </Chip>
            <span className="min-w-0 flex-1 text-[10px] leading-snug text-[var(--ink-3)]">
              {brief.confidenceReason}
            </span>
          </div>

          {SECTIONS.map(([key, label]) => {
            const value = brief[key];
            if (typeof value !== "string" || !value) return null;
            return (
              <div key={key} className="px-3 py-2">
                <div className="mb-0.5 text-[9.5px] uppercase tracking-wide text-[var(--ink-3)]">
                  {label}
                </div>
                <p className="text-[11px] leading-relaxed text-[var(--ink)]">{value}</p>
              </div>
            );
          })}

          {brief.topRisks.length > 0 && (
            <div className="px-3 py-2">
              <div className="mb-0.5 text-[9.5px] uppercase tracking-wide text-rose-400">
                Top Risks
              </div>
              <ul className="list-disc space-y-0.5 pl-4">
                {brief.topRisks.map((r, i) => (
                  <li key={i} className="text-[11px] leading-relaxed">
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="px-3 py-2">
            <div className="mb-1 text-[9.5px] uppercase tracking-wide text-[var(--ink-3)]">
              Sources / Confidence
            </div>
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Claim</th>
                  <th className="tl">Basis</th>
                  <th className="tl">Detail</th>
                </tr>
              </thead>
              <tbody>
                {brief.sources.map((s, i) => (
                  <tr key={i}>
                    <td className="tl max-w-[260px] whitespace-normal">{s.claim}</td>
                    <td className="tl">
                      <Chip tone={BASIS_TONE[s.basis]}>{s.basis}</Chip>
                    </td>
                    <td className={cn("tl max-w-[320px] whitespace-normal text-[10px] text-[var(--ink-3)]")}>
                      {s.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[9.5px] leading-snug text-[var(--ink-3)]">
              <strong>FACT</strong> is computed from filings and market data in this terminal.{" "}
              <strong>SOURCE-DERIVED VIEW</strong> is drawn from publicly reported commentary —
              this application has no access to paywalled or private research from any
              institution. <strong>AI INFERENCE</strong> is the model&apos;s own reasoning and
              carries no external backing. Not investment advice.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
