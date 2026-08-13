"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getSupabaseServer, isAuthConfigured } from "@/lib/server/auth";
import { notifyAuthEvent, type AuthEvent } from "@/lib/server/notify";

/**
 * Sign-in, sign-up and sign-out.
 *
 * Server Actions rather than a client-side Supabase call, so the session
 * cookie is set by the server and is httpOnly — a token in browser-readable
 * storage is a token any injected script can take.
 *
 * Errors come back as strings for the form to render. They deliberately do not
 * distinguish "no such account" from "wrong password": that difference tells
 * an attacker which addresses are registered.
 */

export interface AuthResult {
  error: string | null;
}

const CREDENTIAL_ERROR = "Email or password is incorrect.";

/**
 * Tell the operator, without making them wait.
 *
 * Not awaited: a slow or failing mail API must not delay a sign-in, and the
 * notification is not worth failing the request over.
 */
async function announce(event: AuthEvent, email: string, userId: string): Promise<void> {
  const h = await headers();
  void notifyAuthEvent({
    event,
    email,
    userId,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });
}

function readCredentials(form: FormData): { email: string; password: string } | null {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return null;
  return { email, password };
}

export async function signIn(_prev: AuthResult, form: FormData): Promise<AuthResult> {
  if (!isAuthConfigured()) {
    return { error: "Accounts are not configured on this deployment." };
  }
  const creds = readCredentials(form);
  if (!creds) return { error: "Enter an email and a password." };

  const sb = await getSupabaseServer();
  if (!sb) return { error: "Accounts are not configured on this deployment." };

  const { data, error } = await sb.auth.signInWithPassword(creds);
  if (error) return { error: CREDENTIAL_ERROR };

  if (data.user) await announce("signin", creds.email, data.user.id);

  const next = String(form.get("next") ?? "/positions");
  // Only relative paths: an attacker-supplied absolute URL here would turn the
  // login form into an open redirect.
  revalidatePath("/", "layout");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/positions");
}

export async function signUp(_prev: AuthResult, form: FormData): Promise<AuthResult> {
  if (!isAuthConfigured()) {
    return { error: "Accounts are not configured on this deployment." };
  }
  const creds = readCredentials(form);
  if (!creds) return { error: "Enter an email and a password." };
  if (creds.password.length < 8) {
    return { error: "Use at least 8 characters." };
  }

  const sb = await getSupabaseServer();
  if (!sb) return { error: "Accounts are not configured on this deployment." };

  const { data, error } = await sb.auth.signUp(creds);
  if (error) return { error: error.message };

  // With email confirmation switched on, Supabase returns a user with no
  // session. Saying so is better than a silent redirect to a login that will
  // not accept them yet.
  if (data.user) await announce("signup", creds.email, data.user.id);

  if (!data.session) {
    return { error: "Check your email to confirm the address, then sign in." };
  }

  revalidatePath("/", "layout");
  redirect("/positions");
}

export async function signOut(): Promise<void> {
  const sb = await getSupabaseServer();
  await sb?.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
