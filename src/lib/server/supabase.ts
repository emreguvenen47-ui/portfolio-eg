import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase is entirely optional. When the env vars are absent every helper
 * returns null and callers fall back to in-process state, so the app boots
 * and works with zero backend configuration.
 *
 * The service-role key is read server-side only and must never be exposed
 * with a NEXT_PUBLIC_ prefix.
 */

let client: SupabaseClient | null = null;
let attempted = false;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (attempted) return client;
  attempted = true;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !key) return null;

  try {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch {
    client = null;
  }
  return client;
}

export const isSupabaseConfigured = (): boolean => getSupabaseAdmin() !== null;

/**
 * True when the failure is "this table has not been created yet".
 *
 * Credentials present but migrations not run is a real state — it is exactly
 * where you are between pasting the env vars and pasting the SQL. Callers
 * treat it as "not configured yet" and fall back to in-process storage, which
 * keeps the app usable during setup. Every other error still throws: a write
 * that reports success while the row never landed is the failure mode worth
 * being loud about.
 *
 * PGRST205 is PostgREST's schema-cache miss; 42P01 is Postgres' own
 * undefined_table, which surfaces when the cache is warm but the table is not.
 */
export function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    /Could not find the table|relation .* does not exist/i.test(error.message ?? "")
  );
}

/**
 * True when the table exists but this key may not touch it.
 *
 * The tables enable row-level security with no policies, which is the right
 * default for private data — but it means the anon key is refused everything
 * and only the service-role key gets through. Since every call in this app is
 * server-side, service-role is the correct credential; the alternative is to
 * add RLS policies, which would expose the data to anyone holding the anon
 * key. This is a configuration state, not a bug, so it is reported as one.
 */
/**
 * True when the table exists but is missing a column this build expects.
 *
 * The state you land in after adding multi-user support and not yet running
 * `data/auth-multiuser.sql`: every table is there, none has `user_id`, and
 * Postgres reports 42703. Left unhandled that surfaced as a raw
 * "column x.user_id does not exist" in the interface, which says nothing about
 * what to do. Treated as a setup step, like a missing table.
 */
export function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || /column .* does not exist/i.test(error.message ?? "");
}

export function isPermissionDenied(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  return error.code === "42501" || /permission denied/i.test(error.message ?? "");
}

export const RLS_HINT =
  "Row-level security is enabled on this table and the configured key has no policy granting access. Set SUPABASE_SERVICE_ROLE_KEY in .env.local — every call in this app is server-side, so the service-role key is the correct credential and bypasses RLS without exposing the data to anon-key holders.";

const warned = new Set<string>();

/**
 * True when the caller should take its in-process path because the table is
 * not there yet. Logs the setup hint once per table rather than on every
 * render. Any other error is left for the caller to throw.
 */
export function useFallback(
  error: { code?: string; message?: string } | null,
  table: string,
): boolean {
  const missing = isMissingTable(error);
  const outdated = isMissingColumn(error);
  const denied = isPermissionDenied(error);
  if (!missing && !denied && !outdated) return false;

  const reason = missing
    ? `Supabase table "${table}" does not exist. Run the migrations in data/*.sql.`
    : outdated
      ? `Supabase table "${table}" is missing a column this build expects — run ` +
        `data/auth-multiuser.sql and data/user-tables.sql, which add user_id and ` +
        `the row-level policies. Until then this table cannot be used.`
      : `Supabase denied access to "${table}". ${RLS_HINT}`;

  // In production either state is a deployment fault, not a setup step.
  // Falling back to local disk there would look like it worked and then lose
  // the data on the next container, so it fails loudly instead.
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${reason} The local fallback store is development-only.`);
  }

  if (!warned.has(table)) {
    warned.add(table);
    console.warn(`[supabase] ${reason} Using the local development store in data/.dev-store.`);
  }
  return true;
}
