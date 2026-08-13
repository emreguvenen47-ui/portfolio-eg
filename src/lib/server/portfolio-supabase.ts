import "server-only";
import type { Portfolio } from "@/lib/types";
import { getSupabaseAdmin, isSupabaseConfigured } from "./supabase";

/**
 * Load portfolio from Supabase.
 *
 * Attempts to fetch portfolio holdings from a `portfolios` table
 * with the following schema:
 *
 * - id (uuid, primary key)
 * - user_id (uuid)
 * - name (text) — portfolio name
 * - meta (jsonb) — PortfolioMeta object
 * - positions (jsonb) — Position[] array
 * - created_at (timestamp)
 * - updated_at (timestamp)
 *
 * Falls back to null if Supabase is not configured or no portfolio found.
 */
export async function loadPortfolioFromSupabase(
  portfolioId?: string,
): Promise<Portfolio | null> {
  if (!isSupabaseConfigured()) return null;

  const sb = getSupabaseAdmin();
  if (!sb) return null;

  try {
    let query = sb.from("portfolios").select("meta, positions");

    if (portfolioId) {
      query = query.eq("id", portfolioId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.warn(`[Supabase] Portfolio fetch failed: ${error.message}`);
      return null;
    }

    if (!data) {
      console.info("[Supabase] No portfolio found in database");
      return null;
    }

    return {
      meta: data.meta,
      positions: data.positions || [],
    } as Portfolio;
  } catch (err) {
    console.warn(
      `[Supabase] Portfolio load error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Save portfolio to Supabase.
 *
 * Creates or updates a portfolio record.
 * Requires the portfolio to have an ID in meta or as a separate param.
 */
export async function savePortfolioToSupabase(
  portfolio: Portfolio,
  portfolioId?: string,
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const sb = getSupabaseAdmin();
  if (!sb) return false;

  try {
    const id = portfolioId;
    if (!id) {
      console.warn("[Supabase] Cannot save portfolio without ID");
      return false;
    }

    const { error } = await sb
      .from("portfolios")
      .upsert(
        {
          id,
          meta: portfolio.meta,
          positions: portfolio.positions,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

    if (error) {
      console.warn(`[Supabase] Portfolio save failed: ${error.message}`);
      return false;
    }

    console.info(`[Supabase] Portfolio ${id} saved`);
    return true;
  } catch (err) {
    console.warn(
      `[Supabase] Portfolio save error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * List all portfolios for the current user.
 */
export async function listPortfoliosFromSupabase(): Promise<
  Array<{ id: string; name: string; updatedAt: string }>
> {
  if (!isSupabaseConfigured()) return [];

  const sb = getSupabaseAdmin();
  if (!sb) return [];

  try {
    const { data, error } = await sb
      .from("portfolios")
      .select("id, name, updated_at")
      .order("updated_at", { ascending: false });

    if (error) {
      console.warn(`[Supabase] Portfolio list failed: ${error.message}`);
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      name: row.name,
      updatedAt: row.updated_at,
    }));
  } catch (err) {
    console.warn(
      `[Supabase] Portfolio list error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}
