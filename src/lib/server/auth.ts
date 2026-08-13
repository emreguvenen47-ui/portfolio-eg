import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Request-scoped Supabase client, authenticated as the signed-in user.
 *
 * THE POINT OF THIS FILE: every user-owned read and write goes through a
 * client carrying the caller's own JWT, so row-level security is what enforces
 * isolation — not a `.eq("user_id", …)` that a future edit might forget.
 *
 * The service-role client still exists for public reference data (the congress
 * ledger, cached job snapshots) because that data belongs to nobody. It must
 * never touch a user-owned table: service_role bypasses RLS entirely, which
 * would turn a single missing filter into a cross-account leak.
 */

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const anon = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

export const isAuthConfigured = (): boolean => Boolean(url() && anon());

/**
 * A client bound to the request's cookies.
 *
 * Returns null when Supabase is not configured, so a local instance without
 * credentials still boots — the callers treat that as "no account system" and
 * fall back to the single-user local store.
 */
export async function getSupabaseServer(): Promise<SupabaseClient | null> {
  if (!isAuthConfigured()) return null;
  const store = await cookies();

  return createServerClient(url(), anon(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

export interface SessionUser {
  id: string;
  email: string | null;
}

/**
 * The signed-in user, verified against Supabase.
 *
 * Uses `getUser()` rather than reading the session out of the cookie:
 * `getSession()` trusts whatever the cookie says, which a client can forge.
 * `getUser()` validates the token with the auth server.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const sb = await getSupabaseServer();
  if (!sb) return null;
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/** Throws rather than returning empty data, so a missing check is loud. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("NOT_AUTHENTICATED");
  return user;
}

/**
 * A client plus the caller's id, for the stores that own user data.
 *
 * Returning both together is deliberate: a store that has the client also has
 * the id it must stamp on writes, so there is no path where a row is inserted
 * without an owner. Null means no account system (local instance) or nobody
 * signed in — callers fall back to the local store.
 */
export async function ownerClient(): Promise<{ sb: SupabaseClient; userId: string } | null> {
  const sb = await getSupabaseServer();
  if (!sb) return null;
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) return null;
  return { sb, userId: data.user.id };
}

/**
 * Like `ownerClient`, but refuses instead of degrading.
 *
 * `ownerClient` returns null both when there is no account system and when
 * nobody is signed in, and the stores treat null as "use the local store".
 * That is right on a laptop and wrong on a deployment: an unauthenticated API
 * call would land in a store shared by every anonymous visitor.
 *
 * So where user data is read or written, use this. Null still means "no
 * account system configured" — a genuinely single-user instance — while a
 * configured deployment with no session throws.
 */
export async function ownerOrRefuse(): Promise<{ sb: SupabaseClient; userId: string } | null> {
  const owner = await ownerClient();
  if (owner) return owner;
  if (isAuthConfigured()) throw new Error("NOT_AUTHENTICATED");
  return null;
}
