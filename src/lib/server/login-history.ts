import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ownerClient } from "./auth";
import { isMissingTable } from "./supabase";

/**
 * Sign-in / sign-up history — day-and-time log per account.
 *
 * Written from the auth Server Actions (signIn/signUp), right after Supabase
 * confirms the credential, using the SAME already-authenticated client — so
 * the insert satisfies its own RLS policy (auth.uid() = user_id) without a
 * separate round trip. Read back with `ownerClient()`, so one account can
 * never see another's login history.
 *
 * Optional like every other table here: a missing `login_events` table (not
 * yet pasted into Supabase) degrades to "no history yet" rather than an error
 * — sign-in itself never depends on this succeeding.
 */

export interface LoginEvent {
  event: "signin" | "signup";
  email: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string; // ISO
}

export async function recordLoginEvent(
  sb: SupabaseClient,
  input: { userId: string; email: string; event: "signin" | "signup"; ip: string | null; userAgent: string | null },
): Promise<void> {
  try {
    await sb.from("login_events").insert({
      user_id: input.userId,
      email: input.email,
      event: input.event,
      ip: input.ip,
      user_agent: input.userAgent,
    });
  } catch {
    // Table not created yet, or any other transient issue — never block
    // sign-in over logging it.
  }
}

export async function getLoginHistory(limit = 200): Promise<{ rows: LoginEvent[]; configured: boolean }> {
  const owner = await ownerClient();
  if (!owner) return { rows: [], configured: false };

  const { data, error } = await owner.sb
    .from("login_events")
    .select("event, email, ip, user_agent, created_at")
    .eq("user_id", owner.userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    // Missing table reads as "not configured yet" (honest), same convention
    // as every other optional Supabase table in this app.
    return { rows: [], configured: !isMissingTable(error) };
  }
  return {
    rows: (data ?? []).map((r) => ({
      event: r.event as "signin" | "signup",
      email: r.email as string,
      ip: (r.ip as string | null) ?? null,
      userAgent: (r.user_agent as string | null) ?? null,
      createdAt: r.created_at as string,
    })),
    configured: true,
  };
}
