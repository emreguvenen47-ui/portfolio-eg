"use client";

import { useEffect, useRef, useState } from "react";
import usePoll from "@/lib/use-poll";
import { Chip, Empty, Note } from "@/components/shell/ui";
import { NewsRow } from "@/components/news/news-row";
import { timeAgo, type NewsPayload } from "@/components/news/types";

/**
 * Live headline → holding impact.
 *
 * Shares `NewsRow` with the /news feed so the linkage rules, the impact chips,
 * and the AI-analyze affordance stay identical in both places; this component
 * adds only the portfolio filter and the new-arrival marker.
 */
export function NewsImpact() {
  const { data, error, loading } = usePoll<NewsPayload>("/api/news", 90_000);
  const items = (data?.items ?? []).filter((i) => i.impacts.length > 0);

  // Remember which stories were already on screen so genuinely new ones can be
  // flagged as they arrive, rather than the list silently reshuffling.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!data) return;
    const ids = data.items.map((i) => i.id);
    if (seen.current === null) {
      // First payload is the baseline: nothing is "new" on initial load.
      seen.current = new Set(ids);
      return;
    }
    const added = ids.filter((id) => !seen.current!.has(id));
    if (added.length === 0) return;
    added.forEach((id) => seen.current!.add(id));
    setFresh(new Set(added));
    const t = setTimeout(() => setFresh(new Set()), 60_000);
    return () => clearTimeout(t);
  }, [data]);

  if (loading) {
    return <div className="p-3 text-[11px] text-[var(--ink-3)]">Loading headlines…</div>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-1.5 text-[10px] text-[var(--ink-3)]">
        <span>
          {items.length} of {data?.scanned ?? 0} headlines touch a holding
        </span>
        {data?.sources.length ? <span>· {data.sources.join(", ")}</span> : null}
        {data?.updatedAt ? <span>· {timeAgo(data.updatedAt)}</span> : null}
        {error ? (
          <span className="text-[var(--down)]">· refresh failed, showing last sweep</span>
        ) : null}
      </div>

      {!data?.companyNews && (
        <Note tone="warn">
          <span>
            Market-wide headlines only. Add{" "}
            <code className="text-[var(--amber)]">FINNHUB_API_KEY</code> to{" "}
            <code className="text-[var(--amber)]">.env.local</code> for per-holding company news.
          </span>
        </Note>
      )}

      {data?.errors.length ? (
        <div className="border-b border-[var(--line)] px-3 py-1 text-[10px] text-[var(--ink-3)]">
          Feeds unavailable: {data.errors.join(" · ")}
        </div>
      ) : null}

      {items.length === 0 ? (
        <Empty>No current headline maps onto a position in this portfolio.</Empty>
      ) : (
        <ul className="divide-y divide-[var(--line-soft)]">
          {items.map((item) => (
            <div key={item.id} className="relative">
              {fresh.has(item.id) && (
                <span className="absolute right-3 top-2 z-10">
                  <Chip tone="pos">NEW</Chip>
                </span>
              )}
              <NewsRow item={item} aiConfigured={data?.aiConfigured ?? false} />
            </div>
          ))}
        </ul>
      )}
    </div>
  );
}
