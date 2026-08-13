import Link from "next/link";
import { getSessionUser, isAuthConfigured } from "@/lib/server/auth";
import { signOut } from "@/app/(auth)/actions";

/**
 * Who is signed in, and the way out.
 *
 * Renders nothing on a local instance with no account system — there is no
 * session to show and a "sign in" link would lead to a page that cannot work.
 */
export async function SessionBadge() {
  if (!isAuthConfigured()) return null;
  const user = await getSessionUser();

  if (!user) {
    return (
      <Link
        href="/login"
        className="rounded-sm border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--ink-2)] hover:border-[var(--amber)] hover:text-[var(--amber)]"
      >
        SIGN IN
      </Link>
    );
  }

  return (
    <form action={signOut} className="flex items-center gap-2">
      <span
        className="hidden max-w-[160px] truncate text-[10px] text-[var(--ink-3)] md:block"
        title={user.email ?? undefined}
      >
        {user.email}
      </span>
      <button
        type="submit"
        className="rounded-sm border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--ink-3)] hover:border-[var(--amber)] hover:text-[var(--amber)]"
      >
        SIGN OUT
      </button>
    </form>
  );
}
