import "server-only";
import { enqueue, queueDepth } from "@/lib/server/warm-queue";
import { loadScreenerUniverse, type UniverseRow } from "./screener-universe";

/**
 * Works through the whole tradable listing in the background.
 *
 * The scanner used to show only whatever a user's own filter had happened to
 * warm, which meant coverage never accumulated and every fresh filter looked
 * like an empty screen. This walks the listing instead, most-traded first, so
 * the table converges on the full universe over time and keeps that progress
 * across restarts — the candidate cache is on disk.
 *
 * Two rules keep it out of the way:
 *
 * - Everything it enqueues sits in a lower priority band than work a user is
 *   waiting on. An active filter always jumps this queue.
 * - It only tops up when the queue is nearly drained, so a user's request is
 *   never behind thousands of background items.
 */

/** Priority floor for user-driven work, so it always outranks the sweep. */
export const USER_PRIORITY_BASE = 1e12;

/** Queue depth below which the sweep adds more. */
const TOPUP_BELOW = 40;

/** How many to add per top-up. Small, so the queue stays responsive. */
const TOPUP_SIZE = 200;

/** Skipped entirely: nothing illiquid enough to be untradable is worth calls. */
const MIN_DOLLAR_VOLUME = 250_000;

interface SweepState {
  /** Index into the liquidity-ordered listing. */
  cursor: number;
  /** Set once the sweep has been round the whole listing. */
  passes: number;
  enabled: boolean;
  lastRunAt: number;
}

const KEY = Symbol.for("pcc.universe.sweep");
const state: SweepState = ((globalThis as unknown as Record<symbol, SweepState>)[KEY] ??= {
  cursor: 0,
  passes: 0,
  enabled: true,
  lastRunAt: 0,
});

export interface SweepStatus {
  enabled: boolean;
  cursor: number;
  passes: number;
  /** Companies in the sweepable listing. */
  total: number;
  /** Of those, how many already have an assembled record. */
  covered: number;
}

/**
 * Top up the background queue from the listing.
 *
 * `isCovered` and `build` are injected rather than imported so this module
 * stays free of the scanner's cache and there is no import cycle.
 */
export async function sweepUniverse(opts: {
  isCovered: (symbol: string) => boolean;
  build: (row: UniverseRow) => Promise<unknown>;
}): Promise<SweepStatus> {
  const universe = await loadScreenerUniverse().catch(() => []);
  const listing = sweepable(universe);

  const covered = listing.filter((r) => opts.isCovered(r.symbol)).length;

  if (!state.enabled || listing.length === 0) {
    return { enabled: state.enabled, cursor: state.cursor, passes: state.passes, total: listing.length, covered };
  }

  // Only add when the queue has room, so this never sits in front of a user.
  if (queueDepth() >= TOPUP_BELOW) {
    return { enabled: true, cursor: state.cursor, passes: state.passes, total: listing.length, covered };
  }

  const batch: UniverseRow[] = [];
  let scanned = 0;
  // Walk forward from the cursor, skipping anything already assembled. Bounded
  // by a full lap so a fully covered listing cannot spin.
  while (batch.length < TOPUP_SIZE && scanned < listing.length) {
    const row = listing[state.cursor % listing.length];
    state.cursor++;
    scanned++;
    if (state.cursor >= listing.length) {
      state.cursor = 0;
      state.passes++;
    }
    if (!opts.isCovered(row.symbol)) batch.push(row);
  }

  enqueue(
    batch.map((row) => ({
      kind: "scanner",
      symbol: row.symbol,
      // Below USER_PRIORITY_BASE by construction, ordered by liquidity within
      // the background band.
      priority: row.dollarVolume ?? 0,
      run: () => opts.build(row),
    })),
  );

  state.lastRunAt = Date.now();
  return { enabled: true, cursor: state.cursor, passes: state.passes, total: listing.length, covered };
}

/** The slice of the listing worth spending calls on. */
export function sweepable(universe: UniverseRow[]): UniverseRow[] {
  return universe
    .filter((r) => (r.dollarVolume ?? 0) >= MIN_DOLLAR_VOLUME)
    .sort((a, b) => (b.dollarVolume ?? 0) - (a.dollarVolume ?? 0));
}

export const setSweepEnabled = (on: boolean): void => {
  state.enabled = on;
};

export const sweepState = (): SweepState => ({ ...state });
