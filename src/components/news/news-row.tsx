"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Chip } from "@/components/shell/ui";
import { fmtPctPoints, fmtUsd, signClass } from "@/lib/format";
import { timeAgo, type NewsAnalysis, type NewsItem } from "./types";

const REASON_LABEL = {
  "holding-feed": "tagged to holding",
  ticker: "ticker in headline",
  theme: "theme match",
  macro: "macro — whole book",
} as const;

const STANCE_TONE = {
  bullish: "pos",
  bearish: "neg",
  neutral: "neutral",
} as const;

/**
 * One headline, with its deterministic portfolio linkage always visible and
 * AI interpretation strictly opt-in.
 *
 * The analysis request fires from the button and nowhere else — not on mount,
 * not on expand, not on scroll into view. Anything automatic here would bill a
 * model call for every headline that happens to render.
 */
export function NewsRow({
  item,
  aiConfigured,
  compact = false,
}: {
  item: NewsItem;
  aiConfigured: boolean;
  compact?: boolean;
}) {
  const [analysis, setAnalysis] = useState<NewsAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    if (loading || analysis) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/news/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          headline: item.headline,
          summary: item.summary,
          source: item.source,
          codes: item.impacts.map((i) => i.code),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setAnalysis(json as NewsAnalysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-2">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-[11px] leading-snug hover:text-[var(--amber)]"
        >
          {item.headline}
        </a>
        {!compact && aiConfigured && !analysis && (
          <button
            type="button"
            onClick={analyze}
            disabled={loading}
            className="shrink-0 rounded-sm border border-[var(--line)] px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.08em] text-[var(--ink-3)] transition-colors hover:border-[var(--amber)] hover:text-[var(--amber)] disabled:opacity-50"
          >
            <Sparkles className="mr-1 inline h-2.5 w-2.5" strokeWidth={2} />
            {loading ? "analyzing…" : "AI analyze"}
          </button>
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--ink-3)]">
        <span>{item.source}</span>
        <span>·</span>
        <span>{timeAgo(item.publishedAt)}</span>
        {item.ticker && (
          <>
            <span>·</span>
            <span className="text-[var(--ink-2)]">{item.ticker}</span>
          </>
        )}
        {item.categories.slice(0, 3).map((c) => (
          <span key={c} className="rounded-sm border border-[var(--line)] px-1 py-px text-[9px]">
            {c}
          </span>
        ))}
        {item.impacts.length > 0 && (
          <span
            className={signClass(item.netPnl)}
            title="Combined move of the matched holdings so far today. This is what they did, not an attribution of that move to this headline."
          >
            matched holdings {fmtUsd(item.netPnl)} ({fmtPctPoints(item.netPct)} of book)
          </span>
        )}
      </div>

      {item.impacts.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {item.impacts.slice(0, compact ? 4 : 8).map((im) => (
            <Link
              key={im.code}
              href={`/positions/${im.code}`}
              title={`${REASON_LABEL[im.reason]}: ${im.matched}`}
            >
              <Chip tone={(im.dailyPct ?? 0) >= 0 ? "pos" : "neg"}>
                {im.code} {im.dailyPct === null ? "—" : fmtPctPoints(im.dailyPct)}
              </Chip>
            </Link>
          ))}
        </div>
      )}

      {error && <p className="mt-1 text-[10px] text-[var(--down)]">{error}</p>}

      {analysis && (
        <div className="mt-2 border-l-2 border-[var(--amber)]/50 bg-[var(--panel-2)] px-2 py-1.5">
          <div className="flex items-center gap-2">
            <Chip tone={STANCE_TONE[analysis.stance]}>{analysis.stance.toUpperCase()}</Chip>
            <span className="text-[9.5px] uppercase tracking-[0.08em] text-[var(--ink-3)]">
              {analysis.confidence} confidence · AI interpretation, not a recommendation
            </span>
          </div>
          <p className="mt-1 text-[10.5px] leading-snug text-[var(--ink-2)]">
            {analysis.whyItMatters}
          </p>
          {analysis.affected.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {analysis.affected.map((a) => (
                <li key={a.code} className="text-[10px] leading-snug">
                  <span
                    className={
                      a.direction === "positive"
                        ? "pos"
                        : a.direction === "negative"
                          ? "neg"
                          : "text-[var(--ink-3)]"
                    }
                  >
                    {a.code}
                  </span>{" "}
                  <span className="text-[var(--ink-3)]">{a.note}</span>
                </li>
              ))}
            </ul>
          )}
          {analysis.secondOrder.length > 0 && (
            <div className="mt-1">
              <span className="text-[9.5px] uppercase tracking-[0.08em] text-[var(--ink-3)]">
                Second-order
              </span>
              <ul className="mt-0.5 space-y-0.5">
                {analysis.secondOrder.map((s) => (
                  <li key={s} className="text-[10px] leading-snug text-[var(--ink-3)]">
                    · {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
