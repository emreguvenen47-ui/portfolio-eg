import "server-only";
import { randomUUID } from "node:crypto";
import { ownerOrRefuse } from "./auth";
import { useFallback } from "./supabase";
import { devCollection } from "./dev-store";
import type { Combinator, Criterion } from "@/lib/screener/filter";

/**
 * Saved custom screens.
 *
 * A screen is the question, not the answer: the universe filters, the criteria
 * and the columns. Results are never stored — they would be stale within the
 * hour and a screen that shows yesterday's matches under today's date is worse
 * than one that simply re-runs.
 */

export interface SavedScreen {
  id: string;
  name: string;
  /** Universe filters, mirroring the screener's pool controls. */
  pool: {
    regions: string[];
    sectors: string[];
    industries: string[];
    buckets: string[];
    minMarketCap: number | null;
    maxMarketCap: number | null;
    minDollarVolume: number | null;
    minPrice: number | null;
  };
  combinator: Combinator;
  criteria: Criterion[];
  columns: string[];
  createdAt: string;
  updatedAt: string;
}

const TABLE = "saved_screens";
const memory = devCollection<SavedScreen>("saved-screens");

const toRow = (s: SavedScreen) => ({
  id: s.id,
  name: s.name,
  pool: s.pool,
  combinator: s.combinator,
  criteria: s.criteria,
  columns: s.columns,
  created_at: s.createdAt,
  updated_at: s.updatedAt,
});

const fromRow = (r: Record<string, unknown>): SavedScreen => ({
  id: String(r.id),
  name: String(r.name ?? "Untitled screen"),
  pool: (r.pool ?? {}) as SavedScreen["pool"],
  combinator: (r.combinator === "OR" ? "OR" : "AND") as Combinator,
  criteria: (r.criteria ?? []) as Criterion[],
  columns: (r.columns ?? []) as string[],
  createdAt: String(r.created_at ?? new Date().toISOString()),
  updatedAt: String(r.updated_at ?? new Date().toISOString()),
});

export async function listScreens(): Promise<SavedScreen[]> {
  const owner = await ownerOrRefuse();
  if (owner) {
    // No .eq("user_id", …) here on purpose: the RLS policy is the filter, so a
    // query that forgets one returns nothing rather than everything.
    const { data, error } = await owner.sb
      .from(TABLE)
      .select("*")
      .order("updated_at", { ascending: false });
    if (!error) return (data ?? []).map(fromRow);
    if (!useFallback(error, TABLE)) {
      throw new Error(`Failed to load saved screens: ${error.message}`);
    }
  }
  return memory.all().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function persist(s: SavedScreen): Promise<SavedScreen> {
  const owner = await ownerOrRefuse();
  if (owner) {
    const { error } = await owner.sb.from(TABLE).upsert({ ...toRow(s), user_id: owner.userId });
    if (!error) return s;
    if (!useFallback(error, TABLE)) {
      throw new Error(`Failed to save screen: ${error.message}`);
    }
  }
  memory.set(s.id, s);
  return s;
}

export async function saveScreen(
  input: Omit<SavedScreen, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<SavedScreen> {
  const now = new Date().toISOString();
  const existing = input.id ? await getScreen(input.id) : null;
  return persist({
    ...input,
    id: existing?.id ?? input.id ?? randomUUID(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

export async function getScreen(id: string): Promise<SavedScreen | null> {
  const owner = await ownerOrRefuse();
  if (owner) {
    const { data, error } = await owner.sb.from(TABLE).select("*").eq("id", id).maybeSingle();
    if (!error) return data ? fromRow(data) : null;
    if (!useFallback(error, TABLE)) {
      throw new Error(`Failed to load screen: ${error.message}`);
    }
  }
  return memory.get(id) ?? null;
}

export async function deleteScreen(id: string): Promise<boolean> {
  const owner = await ownerOrRefuse();
  if (owner) {
    const { error } = await owner.sb.from(TABLE).delete().eq("id", id);
    if (!error) return true;
    if (!useFallback(error, TABLE)) {
      throw new Error(`Failed to delete screen: ${error.message}`);
    }
  }
  return memory.delete(id);
}

export async function duplicateScreen(id: string): Promise<SavedScreen | null> {
  const s = await getScreen(id);
  if (!s) return null;
  const now = new Date().toISOString();
  return persist({ ...s, id: randomUUID(), name: `${s.name} copy`, createdAt: now, updatedAt: now });
}
