import "server-only";
import { diskCache } from "@/lib/server/disk-cache";

/**
 * Decision History / Time Machine store (master spec §21, §50).
 *
 * Append-only per-symbol snapshots of what the platform believed at a point
 * in time: fair value, consensus, forward EPS, revision score, technical
 * state. Never rewritten with future information — that is the whole point.
 *
 * Backed by the existing atomic disk cache (data/.cache). One snapshot per
 * symbol per calendar day at most; re-running a page the same day updates
 * nothing, so history stays honest.
 */

export interface EgSnapshot {
  date: string; // yyyy-mm-dd
  price: number | null;
  fairValue: number | null;
  fairLow: number | null;
  fairHigh: number | null;
  upsidePct: number | null;
  confidence: string | null;
  consensusTarget: number | null;
  forwardEps: number | null;
  revisionScore: number | null;
  technicalState: string | null;
  primarySupport: number | null;
  primaryResistance: number | null;
}

const store = diskCache<EgSnapshot[]>("eg-snapshots", Number.MAX_SAFE_INTEGER);

export function recordSnapshot(symbol: string, snap: Omit<EgSnapshot, "date">): void {
  const key = symbol.toUpperCase();
  const today = new Date().toISOString().slice(0, 10);
  const history = store.get(key) ?? [];
  if (history.some((h) => h.date === today)) return; // one per day, never rewrite
  history.push({ date: today, ...snap });
  // Keep a bounded but long memory.
  store.set(key, history.slice(-750));
}

export function getSnapshotHistory(symbol: string): EgSnapshot[] {
  return store.get(symbol.toUpperCase()) ?? [];
}

/** WHAT CHANGED? — diff the latest snapshot against one ~N days earlier. */
export function diffSnapshots(
  symbol: string,
  daysBack: number,
): { from: EgSnapshot; to: EgSnapshot; changes: string[] } | null {
  const history = getSnapshotHistory(symbol);
  if (history.length < 2) return null;
  const to = history[history.length - 1]!;
  const cutoff = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);
  const from = [...history].reverse().find((h) => h.date <= cutoff) ?? history[0]!;
  if (from.date === to.date) return null;

  const changes: string[] = [];
  const num = (label: string, a: number | null, b: number | null, unit = "") => {
    if (a === null || b === null || Math.abs(b - a) < 1e-9) return;
    const sign = b > a ? "+" : "";
    changes.push(`${label}: ${a}${unit} → ${b}${unit} (${sign}${(b - a).toFixed(2)}${unit})`);
  };
  num("EG Fair Value", from.fairValue, to.fairValue, "$");
  num("Consensus target", from.consensusTarget, to.consensusTarget, "$");
  num("Forward EPS", from.forwardEps, to.forwardEps, "$");
  num("Revision score", from.revisionScore, to.revisionScore);
  if (from.technicalState !== to.technicalState) {
    changes.push(`Technical state: ${from.technicalState ?? "?"} → ${to.technicalState ?? "?"}`);
  }
  return { from, to, changes };
}
