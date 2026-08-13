"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import usePoll from "@/lib/use-poll";
import { StatusBadge } from "./ui";
import type { DataStatus } from "@/lib/types";

type FeedState = "LIVE" | "STALE" | "OFFLINE";

interface StatusPayload {
  status: DataStatus;
  feed: FeedState;
  provider: string;
  configured: boolean;
  providers: string[];
  reason?: string;
  dataUpdatedAt: string;
  lastSuccessAt: string | null;
  refreshMs: number;
  marketOpen: boolean;
  requestBudget: { used: number; limit: number };
  updatedAt: string;
}

const FEED_STYLES: Record<FeedState, string> = {
  LIVE: "border-emerald-500/50 bg-emerald-500/10 text-emerald-400",
  STALE: "border-amber-500/50 bg-amber-500/10 text-amber-400",
  OFFLINE: "border-rose-500/50 bg-rose-500/10 text-rose-400",
};

const DEFAULT_REFRESH_MS = 15_000;

/**
 * Global data-source indicator AND the app's live-update engine.
 *
 * Almost every price on this site is rendered on the server, so the only way
 * for those numbers to move is to re-render the route. `router.refresh()`
 * re-fetches the RSC payload and React reconciles it in place — no navigation,
 * no remount, no white flash — which is why prices update smoothly rather than
 * blinking.
 *
 * It lives in the header because that is the one component mounted on every
 * route, so a single timer drives the whole app.
 */
export function HeaderStatus() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);

  const { data } = usePoll<StatusPayload>("/api/status", DEFAULT_REFRESH_MS);
  // Follow the server's cadence once we know it; refreshing faster than the
  // provider cache TTL just re-renders identical numbers.
  const refreshMs = data?.refreshMs && data.refreshMs > 0 ? data.refreshMs : DEFAULT_REFRESH_MS;

  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
      setLastRefresh(Date.now());
    });
  }, [router]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") refreshRef.current();
    };
    const timer = setInterval(tick, refreshMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshMs]);

  // Keep the badge stable on the very first paint instead of flashing
  // "CONNECTING" for one tick on every navigation.
  const status: DataStatus = data?.status ?? "MARKET_CLOSED";
  const feed: FeedState = data?.feed ?? "LIVE";
  // Prefer the last time a provider actually answered — a local router refresh
  // that served entirely from cache did not make the prices any newer.
  const stamp = data?.lastSuccessAt
    ? Date.parse(data.lastSuccessAt)
    : (lastRefresh ?? (data ? Date.parse(data.dataUpdatedAt) : null));

  return (
    <div className="flex items-center gap-2">
      <span
        className="hidden text-[10px] tabular-nums text-[var(--ink-3)] md:inline"
        title={
          data
            ? [
                `Source: ${data.provider}`,
                `Market ${data.marketOpen ? "open" : "closed"} — refreshing every ${Math.round(refreshMs / 1000)}s`,
                `Requests used this minute: ${data.requestBudget.used}/${data.requestBudget.limit}`,
              ].join("\n")
            : undefined
        }
      >
        Last updated:{" "}
        {stamp
          ? new Date(stamp).toLocaleTimeString("en-GB", { timeZone: "UTC" })
          : "--:--:--"}{" "}
        UTC
      </span>
      <span
        className={`chip ${FEED_STYLES[feed]}`}
        title={
          feed === "STALE"
            ? "Refresh failed — showing the last real prices, not generated ones"
            : feed === "OFFLINE"
              ? "No live provider is reachable"
              : "Feed is refreshing normally"
        }
      >
        {feed}
      </span>
      <button
        type="button"
        onClick={refresh}
        aria-label="Refresh prices now"
        title="Refresh prices now"
        className="rounded-sm p-1 text-[var(--ink-3)] transition-colors hover:text-[var(--amber)]"
      >
        <RefreshCw
          className={`h-3 w-3 ${pending ? "animate-spin text-[var(--amber)]" : ""}`}
          strokeWidth={2}
        />
      </button>
      <StatusBadge status={status} reason={data?.reason} />
    </div>
  );
}
