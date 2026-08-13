import "server-only";
import { DEFAULT_SETTINGS, type AppSettings } from "@/lib/portfolio/settings";
import { ownerClient } from "./auth";

/**
 * Settings persistence, per account.
 *
 * The previous version kept the whole thing in one module-level `memory`
 * variable. In a single-user desktop tool that is fine; on a shared
 * deployment it is a cross-account leak, because one server process handles
 * every visitor and whoever loaded last decided what everyone else saw. The
 * cache is now keyed by user id, and the unauthenticated key is only reachable
 * on a local instance with no account system configured.
 *
 * Supabase remains optional: without it the app runs on the in-process copy,
 * which is the right default for running this on your own machine.
 */

const LOCAL = "__local__";

const CACHE_KEY = Symbol.for("pcc.settings.byUser");
const cache: Map<string, AppSettings> = ((
  globalThis as unknown as Record<symbol, Map<string, AppSettings>>
)[CACHE_KEY] ??= new Map());

export async function getSettings(): Promise<AppSettings> {
  const owner = await ownerClient();
  const key = owner?.userId ?? LOCAL;

  const hit = cache.get(key);
  if (hit) return hit;

  if (!owner) {
    const value = { ...DEFAULT_SETTINGS };
    cache.set(key, value);
    return value;
  }

  let value: AppSettings = { ...DEFAULT_SETTINGS };
  try {
    // RLS scopes this to the caller; no user_id filter to forget.
    const { data, error } = await owner.sb
      .from("settings")
      .select("value")
      .maybeSingle();
    if (!error && data?.value) {
      value = { ...DEFAULT_SETTINGS, ...(data.value as Partial<AppSettings>) };
    }
  } catch {
    // Persistence is best-effort; never block a render on it.
  }

  cache.set(key, value);
  return value;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const owner = await ownerClient();
  const key = owner?.userId ?? LOCAL;

  const next = { ...(cache.get(key) ?? DEFAULT_SETTINGS), ...patch };
  cache.set(key, next);

  if (owner) {
    try {
      await owner.sb
        .from("settings")
        .upsert({ user_id: owner.userId, value: next }, { onConflict: "user_id" });
    } catch {
      // Swallow: the cached value is still updated and returned.
    }
  }
  return next;
}
