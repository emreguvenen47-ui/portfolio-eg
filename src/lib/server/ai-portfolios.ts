import "server-only";
import { randomUUID } from "node:crypto";
import { ownerOrRefuse } from "./auth";
import { useFallback } from "./supabase";
import { devCollection } from "./dev-store";
import type {
  BuiltPortfolio,
  InvestorProfile,
  PortfolioRole,
  RiskExplanation,
} from "@/lib/ai/portfolio-model";
import type { AssetClass, Region } from "@/lib/types";

/**
 * Storage for generated portfolios.
 *
 * These are kept entirely apart from the real book — separate table, separate
 * API surface, no write path from here into `settings` or the workbook. A
 * modelled portfolio is research output; it must never be able to silently
 * become the thing the risk pages are measuring.
 *
 * Supabase stays optional, as everywhere else in this app: without it the
 * store is in-process, so the feature works on a fresh checkout and simply
 * does not survive a restart.
 */

export type PositionSource = "ai" | "manual";

export interface SavedPosition {
  ticker: string;
  name: string;
  /** Current weight, 0..1. */
  weight: number;
  /** What the model first proposed. Null for a hand-added position. */
  originalWeight: number | null;
  assetClass: AssetClass;
  region: Region;
  role: PortfolioRole;
  reason: string;
  source: PositionSource;
  addedAt: string;
}

/**
 * One allocation, valid from `at` until the next epoch begins.
 *
 * Editing a portfolio appends an epoch rather than overwriting the previous
 * one. That is the whole mechanism behind "do not rewrite old performance as
 * if the new allocation always existed": performance walks the epochs in
 * order, so yesterday's return is still computed from yesterday's weights.
 */
export interface AllocationEpoch {
  at: string;
  note: string;
  positions: SavedPosition[];
}

/** Prices captured when the portfolio was saved — the performance baseline. */
export interface Baseline {
  at: string;
  amount: number;
  currency: string;
  /** ticker -> the real quote at save time, or null when none was available. */
  prices: Record<
    string,
    { price: number; provider: string; timestamp: string } | null
  >;
}

export interface SavedPortfolio {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  profile: InvestorProfile;
  risk: RiskExplanation;
  /** The original AI output, never mutated by manual edits. */
  built: BuiltPortfolio;
  baseline: Baseline;
  allocations: AllocationEpoch[];
}

/**
 * Fallback store, used when Supabase is unavailable.
 *
 * Disk-backed rather than memory-only. A generated portfolio is real work —
 * it took a model call and a set of answers to produce — and losing it to a
 * dev server restart is a data-loss bug, not a graceful degradation.
 */
const memory = devCollection<SavedPortfolio>("ai-portfolios");

const TABLE = "ai_portfolios";

/** Allocation in force right now. */
export function currentAllocation(p: SavedPortfolio): AllocationEpoch {
  return p.allocations[p.allocations.length - 1];
}

/** Every ticker the portfolio has ever held, across all epochs. */
export function allTickers(p: SavedPortfolio): string[] {
  return [...new Set(p.allocations.flatMap((a) => a.positions.map((x) => x.ticker)))];
}

/**
 * Fill in fields added after a record was written.
 *
 * Rows saved before epochs and baselines existed still load: their single
 * allocation is reconstructed from `built`, and an absent baseline is
 * signalled by empty prices so the UI can mark positions as lacking one rather
 * than inventing a starting value.
 */
function migrate(p: SavedPortfolio): SavedPortfolio {
  if (p.allocations?.length && p.baseline) return p;

  const positions: SavedPosition[] = (p.built?.positions ?? []).map((x) => ({
    ticker: x.ticker,
    name: x.name,
    weight: x.weight,
    originalWeight: x.weight,
    assetClass: x.assetClass,
    region: x.region,
    role: x.role,
    reason: x.reason,
    source: "ai",
    addedAt: p.createdAt,
  }));

  return {
    ...p,
    baseline: p.baseline ?? {
      at: p.createdAt,
      amount: p.built?.amount ?? 0,
      currency: p.built?.currency ?? "USD",
      prices: {},
    },
    allocations: p.allocations?.length
      ? p.allocations
      : [{ at: p.createdAt, note: "created", positions }],
  };
}

function toRow(p: SavedPortfolio) {
  return {
    id: p.id,
    name: p.name,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    profile: p.profile,
    risk: p.risk,
    built: p.built,
    baseline: p.baseline,
    allocations: p.allocations,
  };
}

function fromRow(r: Record<string, unknown>): SavedPortfolio {
  return migrate({
    id: String(r.id),
    name: String(r.name ?? "Untitled"),
    createdAt: String(r.created_at ?? new Date().toISOString()),
    updatedAt: String(r.updated_at ?? new Date().toISOString()),
    profile: r.profile as InvestorProfile,
    risk: r.risk as RiskExplanation,
    built: r.built as BuiltPortfolio,
    baseline: r.baseline as Baseline,
    allocations: (r.allocations ?? []) as AllocationEpoch[],
  });
}

export async function listPortfolios(): Promise<SavedPortfolio[]> {
  const owner = await ownerOrRefuse();
  if (owner) {
    const sb = owner.sb;
    const { data, error } = await sb
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: false });
    if (!error) return (data ?? []).map(fromRow);
    if (!useFallback(error, TABLE)) {
      throw new Error(`Failed to load saved portfolios: ${error.message}`);
    }
  }
  return memory.all().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getPortfolio(id: string): Promise<SavedPortfolio | null> {
  const owner = await ownerOrRefuse();
  if (owner) {
    const sb = owner.sb;
    const { data, error } = await sb.from(TABLE).select("*").eq("id", id).maybeSingle();
    if (!error) return data ? fromRow(data) : null;
    if (!useFallback(error, TABLE)) {
      throw new Error(`Failed to load saved portfolio: ${error.message}`);
    }
  }
  const local = memory.get(id);
  return local ? migrate(local) : null;
}

export async function savePortfolio(input: {
  name: string;
  profile: InvestorProfile;
  risk: RiskExplanation;
  built: BuiltPortfolio;
  baseline: Baseline;
}): Promise<SavedPortfolio> {
  const now = new Date().toISOString();
  const positions: SavedPosition[] = input.built.positions.map((x) => ({
    ticker: x.ticker,
    name: x.name,
    weight: x.weight,
    originalWeight: x.weight,
    assetClass: x.assetClass,
    region: x.region,
    role: x.role,
    reason: x.reason,
    source: "ai",
    addedAt: now,
  }));

  const saved: SavedPortfolio = {
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    allocations: [{ at: now, note: "created", positions }],
  };

  return insert(saved);
}

/**
 * A failed write throws rather than being absorbed by the memory copy. A save
 * that reports success while the row never landed loses the portfolio at the
 * next restart, with the UI having already confirmed it.
 */
async function insert(p: SavedPortfolio): Promise<SavedPortfolio> {
  const owner = await ownerOrRefuse();
  if (owner) {
    const sb = owner.sb;
    const { error } = await sb.from(TABLE).insert({ ...toRow(p), user_id: owner.userId });
    if (!error) return p;
    if (!useFallback(error, TABLE)) {
      throw new Error(`Failed to save portfolio: ${error.message}`);
    }
  }
  memory.set(p.id, p);
  return p;
}

async function persist(p: SavedPortfolio): Promise<SavedPortfolio> {
  const owner = await ownerOrRefuse();
  if (owner) {
    const sb = owner.sb;
    const { error } = await sb.from(TABLE).update(toRow(p)).eq("id", p.id);
    if (!error) return p;
    if (!useFallback(error, TABLE)) {
      throw new Error(`Failed to update portfolio: ${error.message}`);
    }
  }
  memory.set(p.id, p);
  return p;
}

export async function renamePortfolio(id: string, name: string): Promise<SavedPortfolio | null> {
  const existing = await getPortfolio(id);
  if (!existing) return null;
  return persist({ ...existing, name, updatedAt: new Date().toISOString() });
}

/**
 * Replace the live allocation by appending a new epoch.
 *
 * Never mutates the last epoch: the previous weights stay on the record with
 * their own start time, which is what lets the performance engine keep
 * pre-edit history intact.
 */
export async function updateAllocation(
  id: string,
  positions: SavedPosition[],
  note: string,
): Promise<SavedPortfolio | null> {
  const existing = await getPortfolio(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  return persist({
    ...existing,
    updatedAt: now,
    allocations: [...existing.allocations, { at: now, note, positions }],
  });
}

/** Extend the baseline with prices for tickers added after creation. */
export async function addBaselinePrices(
  id: string,
  prices: Baseline["prices"],
): Promise<SavedPortfolio | null> {
  const existing = await getPortfolio(id);
  if (!existing) return null;
  return persist({
    ...existing,
    baseline: { ...existing.baseline, prices: { ...existing.baseline.prices, ...prices } },
  });
}

export async function duplicatePortfolio(id: string): Promise<SavedPortfolio | null> {
  const existing = await getPortfolio(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const copy: SavedPortfolio = {
    ...existing,
    id: randomUUID(),
    name: `${existing.name} (copy)`,
    createdAt: now,
    updatedAt: now,
    // A duplicate starts its own track record from today, priced at today's
    // marks. Inheriting the original's baseline would show a return the copy
    // never earned.
    baseline: { ...existing.baseline, at: now, prices: {} },
    allocations: [
      { at: now, note: "duplicated", positions: currentAllocation(existing).positions },
    ],
  };

  return insert(copy);
}

export async function deletePortfolio(id: string): Promise<boolean> {
  const owner = await ownerOrRefuse();
  if (owner) {
    const sb = owner.sb;
    const { error } = await sb.from(TABLE).delete().eq("id", id);
    if (!error) return true;
    if (!useFallback(error, TABLE)) {
      throw new Error(`Failed to delete portfolio: ${error.message}`);
    }
  }
  return memory.delete(id);
}
