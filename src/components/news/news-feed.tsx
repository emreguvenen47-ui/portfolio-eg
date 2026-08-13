"use client";

import { useMemo, useState } from "react";
import usePoll from "@/lib/use-poll";
import { Empty, Note } from "@/components/shell/ui";
import { cn } from "@/lib/utils";
import { NewsRow } from "./news-row";
import { timeAgo, type NewsCategory, type NewsPayload } from "./types";

/**
 * The /news feed: filterable, live, and AI-free until asked.
 *
 * Filtering happens client-side against categories the server already
 * assigned, so switching tabs costs nothing upstream.
 */
export function NewsFeed() {
  const [active, setActive] = useState<NewsCategory | "All">("Portfolio");
  const { data, error, loading } = usePoll<NewsPayload>("/api/news", 90_000);

  const items = useMemo(() => {
    const all = data?.items ?? [];
    return active === "All" ? all : all.filter((i) => i.categories.includes(active));
  }, [data, active]);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const i of data?.items ?? []) {
      for (const cat of i.categories) c.set(cat, (c.get(cat) ?? 0) + 1);
    }
    return c;
  }, [data]);

  if (loading) {
    return <div className="p-3 text-[11px] text-[var(--ink-3)]">Loading headlines…</div>;
  }

  const tabs: (NewsCategory | "All")[] = ["All", ...(data?.categories ?? [])];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--line)] px-2 py-1.5">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setActive(t)}
            className={cn(
              "rounded-sm border px-2 py-0.5 text-[10px] transition-colors",
              active === t
                ? "border-[var(--amber)] bg-[rgba(255,160,40,0.12)] text-[var(--amber)]"
                : "border-[var(--line)] text-[var(--ink-3)] hover:border-[var(--ink-3)] hover:text-[var(--ink-2)]",
            )}
          >
            {t}
            <span className="ml-1 opacity-60">
              {t === "All" ? (data?.items.length ?? 0) : (counts.get(t) ?? 0)}
            </span>
          </button>
        ))}
        <span className="ml-auto text-[10px] text-[var(--ink-3)]">
          {data?.scanned ?? 0} scanned
          {data?.sources.length ? ` · ${data.sources.join(", ")}` : ""}
          {data?.updatedAt ? ` · ${timeAgo(data.updatedAt)}` : ""}
          {error ? " · refresh failed, showing last sweep" : ""}
        </span>
      </div>

      {!data?.companyNews && (
        <Note tone="warn">
          <span>
            Market-wide headlines only. Add{" "}
            <code className="text-[var(--amber)]">FINNHUB_API_KEY</code> for per-holding company
            news.
          </span>
        </Note>
      )}
      {!data?.aiConfigured && (
        <Note tone="info">
          <span>
            AI ANALYZE is disabled. Add{" "}
            <code className="text-[var(--amber)]">ANTHROPIC_API_KEY</code> to{" "}
            <code className="text-[var(--amber)]">.env.local</code> to enable per-headline analysis.
          </span>
        </Note>
      )}
      {data?.errors.length ? (
        <div className="border-b border-[var(--line)] px-3 py-1 text-[10px] text-[var(--ink-3)]">
          Feeds unavailable: {data.errors.join(" · ")}
        </div>
      ) : null}

      {items.length === 0 ? (
        <Empty>No current headline falls into this filter.</Empty>
      ) : (
        <ul className="divide-y divide-[var(--line-soft)]">
          {items.map((item) => (
            <NewsRow key={item.id} item={item} aiConfigured={data?.aiConfigured ?? false} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Dashboard variant: the five most recent portfolio-relevant headlines. */
export function NewsHeadlines({ limit = 5 }: { limit?: number }) {
  const { data, loading } = usePoll<NewsPayload>("/api/news", 90_000);

  if (loading) {
    return <div className="p-3 text-[11px] text-[var(--ink-3)]">Loading headlines…</div>;
  }

  // Portfolio-touching stories first, then everything else, newest within each.
  const ranked = [...(data?.items ?? [])].sort((a, b) => {
    const ap = a.impacts.length > 0 ? 1 : 0;
    const bp = b.impacts.length > 0 ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return b.publishedAt.localeCompare(a.publishedAt);
  });
  const items = ranked.slice(0, limit);

  if (items.length === 0) return <Empty>No headlines available.</Empty>;

  return (
    <ul className="divide-y divide-[var(--line-soft)]">
      {items.map((item) => (
        <NewsRow
          key={item.id}
          item={item}
          aiConfigured={data?.aiConfigured ?? false}
          compact
        />
      ))}
    </ul>
  );
}
