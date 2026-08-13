import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin, useFallback } from "./supabase";
import { devCollection } from "./dev-store";

/**
 * Daily job-board snapshots.
 *
 * A job board is a level; the useful signal is its change, which only exists
 * if yesterday's count was stored. One row per ticker per day — the unique
 * index in the migration enforces that, so repeat page renders on the same day
 * update rather than accumulate.
 */

const TABLE = "job_snapshots";

export interface JobSnapshot {
  id: string;
  ticker: string;
  company: string;
  total: number;
  byCategory: Record<string, number>;
  source: string;
  capturedAt: string;
}

const memory = devCollection<JobSnapshot>("job-snapshots");

const rowOf = (s: JobSnapshot) => ({
  id: s.id,
  ticker: s.ticker,
  company: s.company,
  total: s.total,
  by_category: s.byCategory,
  source: s.source,
  captured_at: s.capturedAt,
});

const fromRow = (r: Record<string, unknown>): JobSnapshot => ({
  id: String(r.id),
  ticker: String(r.ticker),
  company: String(r.company ?? ""),
  total: Number(r.total ?? 0),
  byCategory: (r.by_category ?? {}) as Record<string, number>,
  source: String(r.source ?? ""),
  capturedAt: String(r.captured_at),
});

export async function saveJobSnapshot(input: {
  ticker: string;
  company: string;
  total: number;
  byCategory: Record<string, number>;
  source: string;
}): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const snap: JobSnapshot = {
    ...input,
    id: randomUUID(),
    capturedAt: new Date().toISOString(),
  };

  const sb = getSupabaseAdmin();
  if (sb) {
    // One row per ticker per day; a same-day re-render refreshes it.
    const { error } = await sb
      .from(TABLE)
      .upsert(rowOf(snap), { onConflict: "ticker,captured_on" });
    if (!error) return;
    if (!useFallback(error, TABLE)) {
      throw new Error(`Failed to save job snapshot: ${error.message}`);
    }
  }
  memory.set(`${input.ticker}:${today}`, snap);
}

/** Snapshots for one ticker, oldest first. */
export async function listJobSnapshots(ticker: string): Promise<JobSnapshot[]> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from(TABLE)
      .select("*")
      .eq("ticker", ticker)
      .order("captured_at", { ascending: true });
    if (!error) return (data ?? []).map(fromRow);
    if (!useFallback(error, TABLE)) {
      throw new Error(`Failed to load job snapshots: ${error.message}`);
    }
  }
  return memory
    .all()
    .filter((s) => s.ticker === ticker)
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}
