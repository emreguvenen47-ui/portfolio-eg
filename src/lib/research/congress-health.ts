import "server-only";
import { diskCache } from "@/lib/server/disk-cache";

/**
 * CONGRESS SOURCE HEALTH — one ledger per upstream, persisted, honest.
 *
 * Every adapter reports its attempts here; the page and /api/congress/health
 * read the SAME record, so what the user sees is what actually happened —
 * never an inferred status. States:
 *   LIVE          — last attempt succeeded with fresh rows
 *   STALE         — upstream failing but valid cached rows exist (age shown)
 *   RATE_LIMITED  — upstream said 429; adapter is backing off
 *   BLOCKED       — upstream said 403/503 (bot wall); adapter is backing off
 *   UNAVAILABLE   — failing and no cached rows at all
 */

export type CongressSourceState = "LIVE" | "STALE" | "RATE_LIMITED" | "BLOCKED" | "UNAVAILABLE";

export interface SourceHealth {
  source: string;
  state: CongressSourceState;
  httpStatus: number | null;
  lastSuccess: string | null; // ISO
  lastAttempt: string | null; // ISO
  /** ms since the cached rows were last refreshed; null = no cache. */
  cacheAgeMs: number | null;
  cachedRows: number;
  note: string | null;
}

const store = diskCache<SourceHealth>("congress-health", Number.POSITIVE_INFINITY);

const empty = (source: string): SourceHealth => ({
  source,
  state: "UNAVAILABLE",
  httpStatus: null,
  lastSuccess: null,
  lastAttempt: null,
  cacheAgeMs: null,
  cachedRows: 0,
  note: null,
});

export function getHealth(source: string): SourceHealth {
  return store.get(source) ?? empty(source);
}

export function reportAttempt(
  source: string,
  outcome: {
    ok: boolean;
    httpStatus: number | null;
    rows?: number;
    cachedRows: number;
    cacheAgeMs: number | null;
    note?: string;
  },
): SourceHealth {
  const prev = getHealth(source);
  const now = new Date().toISOString();
  const state: CongressSourceState = outcome.ok
    ? "LIVE"
    : outcome.httpStatus === 429
      ? outcome.cachedRows > 0
        ? "STALE"
        : "RATE_LIMITED"
      : outcome.httpStatus === 403 || outcome.httpStatus === 503
        ? outcome.cachedRows > 0
          ? "STALE"
          : "BLOCKED"
        : outcome.cachedRows > 0
          ? "STALE"
          : "UNAVAILABLE";
  const next: SourceHealth = {
    source,
    state,
    httpStatus: outcome.httpStatus,
    lastSuccess: outcome.ok ? now : prev.lastSuccess,
    lastAttempt: now,
    cacheAgeMs: outcome.cacheAgeMs,
    cachedRows: outcome.cachedRows,
    note: outcome.note ?? null,
  };
  store.set(source, next);
  store.flushNow();
  return next;
}

/** Is this source inside its post-block backoff window? */
export function inBackoff(source: string, backoffMs: number): boolean {
  const h = getHealth(source);
  if (!h.lastAttempt) return false;
  if (h.state !== "RATE_LIMITED" && h.state !== "BLOCKED" && !(h.state === "STALE" && (h.httpStatus === 429 || h.httpStatus === 403 || h.httpStatus === 503))) {
    return false;
  }
  return Date.now() - Date.parse(h.lastAttempt) < backoffMs;
}

export function allHealth(sources: string[]): SourceHealth[] {
  return sources.map(getHealth);
}
