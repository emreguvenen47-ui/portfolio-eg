"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface PollResult<T> {
  data: T | null;
  error: string | null;
  /** True only until the FIRST response arrives, never on later refreshes. */
  loading: boolean;
  /** True while a background refresh is in flight. */
  refreshing: boolean;
  /** When `data` last changed. */
  updatedAt: number | null;
  refresh: () => void;
}

/**
 * Minimal polling fetcher. Avoids pulling in SWR/React Query for the handful
 * of client-side reads this app makes.
 *
 * Three rules keep the UI from flickering:
 *  1. A failed poll never clears `data` — the last good payload stays on
 *     screen and the error is reported alongside it.
 *  2. `loading` is only true before the first response, so re-renders never
 *     swap a table for a spinner.
 *  3. Polling pauses while the tab is hidden and fires once on re-focus, so a
 *     backgrounded tab does not burn provider quota.
 */
export default function usePoll<T>(url: string | null, intervalMs = 15_000): PollResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const ctl = new AbortController();

    const schedule = () => {
      if (cancelled || intervalMs <= 0) return;
      clearTimeout(timer);
      timer = setTimeout(run, intervalMs);
    };

    async function run() {
      if (cancelled) return;
      // Nothing to show for a hidden tab; wait for `visibilitychange`.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        schedule();
        return;
      }
      setRefreshing(true);
      try {
        const res = await fetch(url as string, { signal: ctl.signal, cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as T;
        if (cancelled || !mounted.current) return;
        setData(json);
        setUpdatedAt(Date.now());
        setError(null);
      } catch (e) {
        if (cancelled || !mounted.current) return;
        if (e instanceof Error && e.name === "AbortError") return;
        // Keep the previous payload on screen; only surface the error.
        setError(e instanceof Error ? e.message : "Request failed");
      } finally {
        if (!cancelled && mounted.current) {
          setLoading(false);
          setRefreshing(false);
          schedule();
        }
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);

    void run();
    return () => {
      cancelled = true;
      ctl.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, intervalMs, nonce]);

  return { data, error, loading, refreshing, updatedAt, refresh };
}
