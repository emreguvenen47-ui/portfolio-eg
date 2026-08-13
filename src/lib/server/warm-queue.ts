import "server-only";

/**
 * Background enrichment queue.
 *
 * The scanner and the screener both need provider data for companies nobody
 * has looked at yet. Fetching that inside the request meant a filter change
 * sat for ninety seconds behind a provider allowance — measured, not guessed:
 * a small/mid industrials scan spent 94.8s warming and 43ms scoring.
 *
 * So requests stop waiting. They report what is cached, hand the rest to this
 * queue and return; the queue works through it at a pace the providers accept
 * and the next request sees more. The response says how many are still coming,
 * which is a truer thing to show than a spinner over an empty table.
 *
 * Two properties matter for correctness:
 *
 * - Only what a caller explicitly enqueues is ever fetched. The queue has no
 *   opinion about which companies are interesting, so a small-cap industrials
 *   screen cannot cause a request for Apple.
 * - A symbol already queued or in flight is not queued twice, so ten users
 *   asking for the same sector produce one set of upstream calls.
 */

export interface WarmTask {
  /** Namespace, so the scanner and screener queues do not collide. */
  kind: string;
  symbol: string;
  /** Higher runs first — dollar volume, in practice. */
  priority: number;
  run: () => Promise<unknown>;
}

interface QueueState {
  pending: Map<string, WarmTask>;
  inFlight: Set<string>;
  running: boolean;
  /** Rolling count, for the status endpoint. */
  completed: number;
  failed: number;
}

const KEY = Symbol.for("pcc.warm.queue");
const q: QueueState = ((globalThis as unknown as Record<symbol, QueueState>)[KEY] ??= {
  pending: new Map(),
  inFlight: new Set(),
  running: false,
  completed: 0,
  failed: 0,
});

/**
 * Concurrency is deliberately low. The providers behind these tasks have their
 * own rate limiters; running eight of these at once just moves the queue from
 * here into a token bucket, where it is less visible and harder to reason
 * about. Four keeps the pipe full without bursting.
 */
const CONCURRENCY = 4;

/** A cap, so a request for the entire market cannot grow the queue forever. */
const MAX_PENDING = 4_000;

const idOf = (kind: string, symbol: string) => `${kind}:${symbol}`;

export function enqueue(tasks: WarmTask[]): number {
  let added = 0;
  for (const t of tasks) {
    if (q.pending.size >= MAX_PENDING) break;
    const id = idOf(t.kind, t.symbol);
    if (q.pending.has(id) || q.inFlight.has(id)) continue;
    q.pending.set(id, t);
    added++;
  }
  if (added > 0) void drain();
  return added;
}

async function drain(): Promise<void> {
  if (q.running) return;
  q.running = true;
  try {
    while (q.pending.size > 0) {
      // Re-sort each round: a later request may have enqueued something more
      // liquid than anything currently waiting, and that is what a user is
      // most likely looking at.
      const batch = [...q.pending.values()]
        .sort((a, b) => b.priority - a.priority)
        .slice(0, CONCURRENCY);
      if (batch.length === 0) break;

      for (const t of batch) {
        const id = idOf(t.kind, t.symbol);
        q.pending.delete(id);
        q.inFlight.add(id);
      }

      await Promise.all(
        batch.map(async (t) => {
          try {
            await t.run();
            q.completed++;
          } catch {
            // A task that fails leaves no cache entry, so the next request
            // simply enqueues it again. Recording it here keeps the failure
            // visible without turning it into a permanent blank.
            q.failed++;
          } finally {
            q.inFlight.delete(idOf(t.kind, t.symbol));
          }
        }),
      );
    }
  } finally {
    q.running = false;
    // A task enqueued during the final await would otherwise sit until the
    // next request arrives.
    if (q.pending.size > 0) void drain();
  }
}

/** How much work is outstanding, for the "enriching N more" line. */
export const queueDepth = (kind?: string): number => {
  if (!kind) return q.pending.size + q.inFlight.size;
  const p = [...q.pending.keys()].filter((k) => k.startsWith(`${kind}:`)).length;
  const f = [...q.inFlight].filter((k) => k.startsWith(`${kind}:`)).length;
  return p + f;
};

export const queueStats = () => ({
  pending: q.pending.size,
  inFlight: q.inFlight.size,
  completed: q.completed,
  failed: q.failed,
});

/** Test seam: drop everything without running it. */
export function resetQueue(): void {
  q.pending.clear();
  q.inFlight.clear();
  q.completed = 0;
  q.failed = 0;
}
