import "server-only";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writablePath } from "./writable-dir";

/**
 * Disk-backed cache for expensive derived records.
 *
 * The scanner and screener each assemble a per-company record out of several
 * metered provider calls. Held only in process memory, that work was destroyed
 * by every restart — and rebuilding it costs hours against a free-tier
 * allowance, so the scanner effectively started from nothing each time and
 * never accumulated coverage.
 *
 * This is a cache, not a store: entries carry their own age, a corrupt or
 * missing file is simply an empty cache, and nothing here is user data. It is
 * gitignored and safe to delete.
 *
 * Reads stay in memory. The file is loaded once per process and written back
 * on a debounce, because a six-thousand-entry map is not something to
 * serialise on every insert.
 */

const DIR = writablePath(".cache");

/** How long after the last write before the file is flushed. */
const FLUSH_DEBOUNCE_MS = 20_000;

interface Entry<T> {
  at: number;
  value: T;
}

interface Slot<T> {
  loaded: boolean;
  dirty: boolean;
  timer: NodeJS.Timeout | null;
  data: Map<string, Entry<T>>;
}

const SLOTS_KEY = Symbol.for("pcc.diskCache.slots");
const slots: Map<string, Slot<unknown>> = ((
  globalThis as unknown as Record<symbol, Map<string, Slot<unknown>> | undefined>
)[SLOTS_KEY] ??= new Map());

function slotFor<T>(name: string): Slot<T> {
  let s = slots.get(name) as Slot<T> | undefined;
  if (!s) {
    s = { loaded: false, dirty: false, timer: null, data: new Map() };
    slots.set(name, s as Slot<unknown>);
  }
  return s;
}

function load<T>(name: string, maxAgeMs: number): Slot<T> {
  const slot = slotFor<T>(name);
  if (slot.loaded) return slot;
  slot.loaded = true;

  try {
    const path = join(DIR, `${name}.json`);
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, Entry<T>>;
      const now = Date.now();
      for (const [k, v] of Object.entries(parsed)) {
        // Expired on the way in, so a long-idle process does not resurrect
        // month-old fundamentals as if they were current.
        if (v && typeof v.at === "number" && now - v.at < maxAgeMs) slot.data.set(k, v);
      }
    }
  } catch {
    // An unreadable cache is an empty cache. Never a startup failure.
  }
  return slot;
}

function scheduleFlush<T>(name: string, slot: Slot<T>): void {
  slot.dirty = true;
  if (slot.timer) return;
  slot.timer = setTimeout(() => {
    slot.timer = null;
    flush(name, slot);
  }, FLUSH_DEBOUNCE_MS);
  // Do not hold the process open for a cache write.
  slot.timer.unref?.();
}

function flush<T>(name: string, slot: Slot<T>): void {
  if (!slot.dirty) return;
  slot.dirty = false;
  try {
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
    const path = join(DIR, `${name}.json`);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(slot.data)), "utf8");
    // Atomic: a crash mid-write leaves the previous file intact rather than a
    // truncated one that would fail to parse on the next boot.
    renameSync(tmp, path);
  } catch {
    // A cache that cannot be written still works, it just does not survive.
  }
}

export interface DiskCache<T> {
  get(key: string): T | undefined;
  has(key: string): boolean;
  set(key: string, value: T): void;
  delete(key: string): void;
  size(): number;
  /** Write now rather than on the debounce. */
  flushNow(): void;
}

/**
 * @param name    file name under data/.cache
 * @param maxAgeMs entries older than this are dropped on read and on load
 */
export function diskCache<T>(name: string, maxAgeMs: number): DiskCache<T> {
  return {
    get(key) {
      const slot = load<T>(name, maxAgeMs);
      const hit = slot.data.get(key);
      if (!hit) return undefined;
      if (Date.now() - hit.at >= maxAgeMs) {
        slot.data.delete(key);
        scheduleFlush(name, slot);
        return undefined;
      }
      return hit.value;
    },
    has(key) {
      const slot = load<T>(name, maxAgeMs);
      const hit = slot.data.get(key);
      return hit !== undefined && Date.now() - hit.at < maxAgeMs;
    },
    set(key, value) {
      const slot = load<T>(name, maxAgeMs);
      slot.data.set(key, { at: Date.now(), value });
      scheduleFlush(name, slot);
    },
    delete(key) {
      const slot = load<T>(name, maxAgeMs);
      if (slot.data.delete(key)) scheduleFlush(name, slot);
    },
    size() {
      return load<T>(name, maxAgeMs).data.size;
    },
    flushNow() {
      const slot = load<T>(name, maxAgeMs);
      flush(name, slot);
    },
  };
}
