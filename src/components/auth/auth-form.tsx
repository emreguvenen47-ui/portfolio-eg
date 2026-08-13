"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { AuthResult } from "@/app/(auth)/actions";

/**
 * Shared sign-in / sign-up form.
 *
 * One component for both, because they differ only in the action, the button
 * and the link underneath — and keeping them together means the error and
 * pending states cannot drift apart between the two pages.
 */

export function AuthForm({
  mode,
  action,
}: {
  mode: "signin" | "signup";
  action: (prev: AuthResult, form: FormData) => Promise<AuthResult>;
}) {
  const [state, formAction, pending] = useActionState<AuthResult, FormData>(action, {
    error: null,
  });
  const params = useSearchParams();
  const next = params.get("next") ?? "";

  const signup = mode === "signup";

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />

      <label className="flex flex-col gap-1">
        <span className="text-[9.5px] uppercase tracking-wide text-[var(--ink-3)]">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="rounded-sm border border-[var(--line)] bg-transparent px-2 py-1.5 text-[12px] outline-none focus:border-[var(--amber)]"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[9.5px] uppercase tracking-wide text-[var(--ink-3)]">Password</span>
        <input
          name="password"
          type="password"
          autoComplete={signup ? "new-password" : "current-password"}
          required
          minLength={signup ? 8 : undefined}
          className="rounded-sm border border-[var(--line)] bg-transparent px-2 py-1.5 text-[12px] outline-none focus:border-[var(--amber)]"
        />
        {signup && (
          <span className="text-[9px] text-[var(--ink-3)]">At least 8 characters.</span>
        )}
      </label>

      {state.error && (
        <p
          role="alert"
          className="rounded-sm border border-[var(--red)] bg-[rgba(255,80,80,0.08)] px-2 py-1.5 text-[10.5px] text-[var(--red)]"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-sm border border-[var(--amber)] bg-[rgba(255,160,40,0.12)] px-3 py-1.5 text-[11px] font-medium text-[var(--amber)] disabled:opacity-50"
      >
        {pending ? "…" : signup ? "CREATE ACCOUNT" : "SIGN IN"}
      </button>

      <p className="text-[10px] text-[var(--ink-3)]">
        {signup ? "Already have an account? " : "No account? "}
        <Link
          href={signup ? "/login" : "/signup"}
          className="text-[var(--amber)] hover:underline"
        >
          {signup ? "Sign in" : "Create one"}
        </Link>
      </p>
    </form>
  );
}
