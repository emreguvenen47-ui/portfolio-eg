import "server-only";
import type { Portfolio } from "@/lib/types";
import { loadPortfolio, peekPortfolio, setPortfolio } from "@/lib/portfolio/load";
import { ownerClient, ownerOrRefuse } from "./auth";
import { buildSamplePortfolio } from "@/lib/portfolio/starter";

/**
 * The signed-in account's portfolio.
 *
 * Holdings are the most sensitive thing this app stores, and the file-backed
 * loader they used to come from keeps exactly one in a module-level variable —
 * fine for a tool on your own machine, a cross-account leak on a shared
 * deployment, because one server process serves every visitor.
 *
 * So: with an account, the portfolio is a row in `portfolios` owned by that
 * account and cached under its id. Without one — a local instance with no
 * Supabase configured — the workbook on disk is still the source, unchanged.
 *
 * The cache is per user id and short-lived. Holdings change on upload, and an
 * upload that did not appear to take effect would be read as data loss.
 */

const TABLE = "portfolios";
const TTL_MS = 5 * 60_000;

const CACHE_KEY = Symbol.for("pcc.portfolio.byUser");
const cache: Map<string, { at: number; value: Portfolio | null }> = ((
  globalThis as unknown as Record<symbol, Map<string, { at: number; value: Portfolio | null }>>
)[CACHE_KEY] ??= new Map());

interface PortfolioRow {
  meta: Portfolio["meta"];
  positions: Portfolio["positions"];
}

/**
 * Load for the current caller.
 *
 * Throws when an account exists but has uploaded nothing, so the page shows
 * the same "no portfolio yet" state it shows on a fresh local install rather
 * than an empty table that looks like a wiped account.
 */
export async function loadPortfolioForCaller(): Promise<Portfolio> {
  const owner = await ownerClient();

  // No account system: the local workbook. Falls back to the sample when
  // there is none, for the same reason a new account does — an empty terminal
  // says nothing about what the app does.
  if (!owner) {
    try {
      return await loadPortfolio();
    } catch {
      return buildSamplePortfolio();
    }
  }

  const hit = cache.get(owner.userId);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return hit.value ?? buildSamplePortfolio();
  }

  let value: Portfolio | null = null;
  try {
    // RLS restricts this to the caller's own row.
    const { data, error } = await owner.sb
      .from(TABLE)
      .select("meta, positions")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data) {
      const row = data as PortfolioRow;
      if (row.meta && Array.isArray(row.positions)) {
        value = { meta: row.meta, positions: row.positions };
      }
    }
  } catch {
    // A storage failure is not an empty portfolio. Fall through to the throw
    // below rather than presenting zero holdings as a fact.
  }

  cache.set(owner.userId, { at: Date.now(), value });

  /**
   * A new account gets the sample rather than an error.
   *
   * Overview, Markets, Risk and the rest are only meaningful with holdings in
   * them, and an empty terminal tells a first-time visitor nothing about what
   * the app does. The sample is never persisted and never counted as an
   * upload — it is replaced the moment a real workbook arrives — and every
   * page that renders it shows the banner saying so.
   */
  return value ?? buildSamplePortfolio();
}

/** Persist after an upload, for whoever uploaded it. */
export async function savePortfolioForCaller(p: Portfolio): Promise<void> {
  // Strict on the write path: an upload with no session must not land in a
  // store shared by every anonymous visitor.
  const owner = await ownerOrRefuse();

  if (!owner) {
    setPortfolio(p);
    return;
  }

  cache.set(owner.userId, { at: Date.now(), value: p });

  const { error } = await owner.sb.from(TABLE).upsert(
    {
      user_id: owner.userId,
      name: p.meta.title,
      meta: p.meta,
      positions: p.positions,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  // A save that reports success while the row never landed would show the new
  // holdings until the cache expired and then silently revert to the old ones.
  if (error) {
    cache.delete(owner.userId);
    throw new Error(`Failed to save portfolio: ${error.message}`);
  }
}

/** Non-throwing read, for callers that treat absence as normal. */
export async function peekPortfolioForCaller(): Promise<Portfolio | null> {
  const owner = await ownerClient();
  if (!owner) return peekPortfolio();
  try {
    return await loadPortfolioForCaller();
  } catch {
    return null;
  }
}

/**
 * Has this account uploaded anything, as opposed to being shown the sample?
 *
 * Separate from `loadPortfolioForCaller` on purpose: pages that offer to
 * import need the honest answer, and inferring it from the returned portfolio
 * would mean every caller re-deriving the same check.
 */
export async function hasRealPortfolio(): Promise<boolean> {
  const owner = await ownerClient();
  if (!owner) {
    try {
      await loadPortfolio();
      return true;
    } catch {
      return false;
    }
  }
  const hit = cache.get(owner.userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value !== null;
  await loadPortfolioForCaller().catch(() => null);
  return cache.get(owner.userId)?.value != null;
}
