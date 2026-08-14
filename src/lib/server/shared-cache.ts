import "server-only";
import { getSupabaseAdmin } from "./supabase";
import { diskCache, type DiskCache } from "./disk-cache";

/**
 * Durable, shared cache for assembled market data.
 *
 * Memory in front, Supabase behind, disk as the local convenience.
 *
 * The scanner spends hours of rate-limited provider calls building its view of
 * the listing. On Vercel that work was written to /tmp, which belongs to one
 * serverless instance — so the count climbed past a thousand and reset to zero
 * on the next deploy. Supabase is the only writable store there, so that is
 * where it goes.
 *
 * Three properties this needs and a plain table gives:
 *
 * - Durable. Survives deploys, instance recycling and idle scale-to-zero.
 * - Shared. One set of upstream calls serves every visitor, rather than each
 *   instance rebuilding its own copy.
 * - Not on the request path. Reads come from the in-memory map; the database
 *   is touched once on hydrate and in batched background writes.
 *
 * It holds no user data — every row is a public fact about a public company —
 * which is why it uses the service role and has no per-user policy.
 */

const TABLE = "market_cache";

/** Flush at most this often, and at most this many rows per flush. */
const FLUSH_INTERVAL_MS = 15_000;
const FLUSH_BATCH = 200;

interface Entry<T> {
  at: number;
  value: T;
}

interface Slot<T> {
  mem: Map<string, Entry<T>>;
  /** Keys written since the last flush. */
  dirty: Set<string>;
  hydrated: boolean;
  hydrating: Promise<void> | null;
  timer: NodeJS.Timeout | null;
  disk: DiskCache<T>;
  maxAgeMs: number;
}

/** Legacy file names, kept so existing local caches carry over. */
const DISK_FILE: Record<string, string> = {
  scanner: "scanner-candidates",
  screener: "screener-rows",
};

const SLOTS = Symbol.for("pcc.sharedCache.slots");
const slots: Map<string, Slot<unknown>> = ((
  globalThis as unknown as Record<symbol, Map<string, Slot<unknown>>>
)[SLOTS] ??= new Map());

function slotFor<T>(kind: string, maxAgeMs: number): Slot<T> {
  let s = slots.get(kind) as Slot<T> | undefined;
  if (!s) {
    s = {
      mem: new Map(),
      dirty: new Set(),
      hydrated: false,
      hydrating: null,
      timer: null,
      /**
       * One file per kind.
       *
       * The first two keep the names their local-only predecessors used, so a
       * machine that has already assembled a listing does not start over. Any
       * other kind gets its own file — an earlier version sent everything that
       * was not "scanner" to the screener's file, and a third kind added later
       * read the screener's rows back as its own type.
       */
      disk: diskCache<T>(DISK_FILE[kind] ?? `shared-${kind}`, maxAgeMs),
      maxAgeMs,
    };
    slots.set(kind, s as Slot<unknown>);
  }
  return s;
}

/**
 * Pull the whole cache into memory once per process.
 *
 * Paged, because a listing-sized table exceeds PostgREST's default row limit
 * and a short read would look like a half-empty cache — which is exactly the
 * symptom this whole file exists to remove.
 */
async function hydrate<T>(kind: string, slot: Slot<T>): Promise<void> {
  if (slot.hydrated) return;
  if (slot.hydrating) return slot.hydrating;

  slot.hydrating = (async () => {
    const cutoff = new Date(Date.now() - slot.maxAgeMs).toISOString();
    const sb = getSupabaseAdmin();

    if (sb) {
      try {
        const PAGE = 1_000;
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await sb
            .from(TABLE)
            .select("symbol, payload, updated_at")
            .eq("kind", kind)
            .gte("updated_at", cutoff)
            .range(from, from + PAGE - 1);
          if (error || !data?.length) break;
          for (const r of data) {
            const row = r as { symbol: string; payload: T; updated_at: string };
            slot.mem.set(row.symbol, {
              at: new Date(row.updated_at).getTime(),
              value: row.payload,
            });
          }
          if (data.length < PAGE) break;
        }
      } catch {
        // An unreachable cache is an empty cache, never a failed boot.
      }
    }

    slot.hydrated = true;
    slot.hydrating = null;
  })();

  return slot.hydrating;
}

function scheduleFlush<T>(kind: string, slot: Slot<T>): void {
  if (slot.timer) return;
  slot.timer = setTimeout(() => {
    slot.timer = null;
    void flush(kind, slot);
  }, FLUSH_INTERVAL_MS);
  slot.timer.unref?.();
}

async function flush<T>(kind: string, slot: Slot<T>): Promise<void> {
  if (slot.dirty.size === 0) return;
  const sb = getSupabaseAdmin();
  if (!sb) {
    slot.dirty.clear();
    return;
  }

  const keys = [...slot.dirty].slice(0, FLUSH_BATCH);
  const rows = keys
    .map((symbol) => {
      const e = slot.mem.get(symbol);
      return e
        ? {
            kind,
            symbol,
            payload: e.value,
            updated_at: new Date(e.at).toISOString(),
          }
        : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  try {
    const { error } = await sb.from(TABLE).upsert(rows, { onConflict: "kind,symbol" });
    // Only clear on success. A failed write leaves the keys dirty so the next
    // flush retries them rather than losing the work silently.
    if (!error) for (const k of keys) slot.dirty.delete(k);
  } catch {
    // Same: keep them dirty.
  }

  if (slot.dirty.size > 0) scheduleFlush(kind, slot);
}

export interface SharedCache<T> {
  /** Must be awaited once before the synchronous reads mean anything. */
  ready(): Promise<void>;
  get(symbol: string): T | undefined;
  has(symbol: string): boolean;
  set(symbol: string, value: T): void;
  size(): number;
  /** Write pending rows now rather than on the timer. */
  flushNow(): Promise<void>;
}

export function sharedCache<T>(kind: string, maxAgeMs: number): SharedCache<T> {
  const slot = slotFor<T>(kind, maxAgeMs);

  const fresh = (e: Entry<T> | undefined): e is Entry<T> =>
    e !== undefined && Date.now() - e.at < maxAgeMs;

  return {
    ready: () => hydrate(kind, slot),
    get(symbol) {
      const hit = slot.mem.get(symbol);
      if (fresh(hit)) return hit.value;
      // Local disk still helps a machine running without Supabase.
      // The disk layer keeps its own timestamps, so a hit there is already
      // within the age limit.
      const onDisk = slot.disk.get(symbol);
      if (onDisk !== undefined) {
        const e = { at: Date.now(), value: onDisk };
        slot.mem.set(symbol, e);
        return onDisk;
      }
      return undefined;
    },
    has(symbol) {
      return fresh(slot.mem.get(symbol)) || slot.disk.has(symbol);
    },
    set(symbol, value) {
      const e = { at: Date.now(), value };
      slot.mem.set(symbol, e);
      slot.disk.set(symbol, value);
      slot.dirty.add(symbol);
      scheduleFlush(kind, slot);
    },
    size: () => slot.mem.size,
    flushNow: () => flush(kind, slot),
  };
}
