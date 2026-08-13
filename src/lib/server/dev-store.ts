import "server-only";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Disk-backed fallback store.
 *
 * Used only when Supabase is unavailable — either no credentials, or
 * credentials present with the migrations not yet run. It exists because the
 * previous fallback lived purely in process memory, which meant every dev
 * server restart silently destroyed saved AI portfolios, paper-trading
 * ledgers and alert rules. Losing a user's work to a routine restart is not
 * an acceptable failure mode for a "fallback".
 *
 * Supabase remains the real store. This is a local file, it is gitignored,
 * and it is not a substitute for running the migrations in `data/*.sql` —
 * it just stops a restart from being destructive in the meantime.
 */

const DIR = join(process.cwd(), "data", ".dev-store");

/**
 * The in-memory copy is still the read path, so nothing gets slower: the file
 * is loaded once per process and written on change.
 */
interface Slot<T> {
  loaded: boolean;
  data: Map<string, T>;
}

const SLOTS_KEY = Symbol.for("pcc.devStore.slots");
const slots: Map<string, Slot<unknown>> = ((
  globalThis as unknown as Record<symbol, Map<string, Slot<unknown>> | undefined>
)[SLOTS_KEY] ??= new Map());

function slotFor<T>(name: string): Slot<T> {
  let s = slots.get(name) as Slot<T> | undefined;
  if (!s) {
    s = { loaded: false, data: new Map<string, T>() };
    slots.set(name, s as Slot<unknown>);
  }
  return s;
}

function fileFor(name: string): string {
  return join(DIR, `${name}.json`);
}

function load<T>(name: string): Map<string, T> {
  const slot = slotFor<T>(name);
  if (slot.loaded) return slot.data;
  slot.loaded = true;

  try {
    const path = fileFor(name);
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, T>;
      for (const [k, v] of Object.entries(parsed)) slot.data.set(k, v);
    }
  } catch {
    // A corrupt or unreadable file must not take the app down. Starting empty
    // is the same position the old memory-only fallback was always in.
  }
  return slot.data;
}

function flush<T>(name: string): void {
  const slot = slotFor<T>(name);
  try {
    mkdirSync(DIR, { recursive: true });
    const path = fileFor(name);
    const tmp = `${path}.tmp`;
    // Write-then-rename so a crash mid-write cannot leave a half-written file
    // where a valid one used to be.
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(slot.data), null, 2));
    renameSync(tmp, path);
  } catch {
    // Read-only filesystem, or no disk. Degrade to memory-only rather than
    // failing the write the caller already considers successful.
  }
}

/** A keyed collection persisted to one JSON file. */
export function devCollection<T>(name: string) {
  return {
    all(): T[] {
      return [...load<T>(name).values()];
    },
    get(id: string): T | undefined {
      return load<T>(name).get(id);
    },
    set(id: string, value: T): void {
      load<T>(name).set(id, value);
      flush<T>(name);
    },
    delete(id: string): boolean {
      const had = load<T>(name).delete(id);
      if (had) flush<T>(name);
      return had;
    },
  };
}

/** An append-only list persisted to one JSON file, newest first. */
export function devList<T>(name: string, cap = 500) {
  const KEY = "items";
  return {
    all(): T[] {
      return (load<T[]>(name).get(KEY) ?? []) as T[];
    },
    prepend(items: T[]): void {
      const next = [...items, ...this.all()].slice(0, cap);
      load<T[]>(name).set(KEY, next);
      flush<T[]>(name);
    },
  };
}
