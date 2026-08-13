import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Session refresh and route protection.
 *
 * Next 16 renamed this convention from `middleware` to `proxy`; the behaviour
 * and the matcher are unchanged.
 *
 * Two jobs, in this order:
 *
 * 1. Refresh the Supabase session cookie. Server Components cannot write
 *    cookies, so without this the access token expires and the user is
 *    silently signed out mid-session.
 * 2. Keep unauthenticated visitors out of the pages that read or write
 *    user-owned data.
 *
 * PRIVATE_PREFIXES is the list that matters. Everything not on it — the
 * scanner, screener, sector flows, markets, company research — is public
 * market data and stays open, which is the point of having a link to share.
 *
 * This is defence in depth, not the boundary itself: the tables carry RLS
 * policies keyed to `auth.uid()`, so a request that got past this middleware
 * still cannot read another account's rows.
 */

const PRIVATE_PREFIXES = [
  "/positions",
  "/risk",
  "/performance",
  "/rebalance",
  "/stress",
  "/alerts",
  "/virtual",
  "/ai-builder",
  "/ai-portfolios",
  "/theses",
  "/watchlist",
  "/settings",
  "/committee",
  "/crisis",
  "/what-if",
  "/currencies",
];

/**
 * API routes that read or write account-owned data.
 *
 * Protected here rather than in each handler: several of them have no
 * try/catch, so a thrown auth error would surface as a 500, and a route added
 * later would be unprotected until somebody remembered. One list, checked
 * before the handler runs.
 */
const PRIVATE_API = [
  "/api/screener/saved",
  "/api/alerts",
  "/api/virtual",
  "/api/ai/portfolios",
  "/api/ai/build",
  "/api/ai/ic-brief",
  "/api/import",
  "/api/settings",
  "/api/market",
];

const AUTH_PAGES = ["/login", "/signup"];

const matches = (path: string, prefixes: string[]) =>
  prefixes.some((p) => path === p || path.startsWith(`${p}/`));

const isPrivate = (path: string) => matches(path, PRIVATE_PREFIXES);
const isPrivateApi = (path: string) => matches(path, PRIVATE_API);

export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  // No Supabase configured: a local single-user instance. Nothing to protect
  // and nothing to refresh, so every route stays open.
  if (!url || !anon) return res;

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) req.cookies.set(name, value);
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of list) res.cookies.set(name, value, options);
      },
    },
  });

  // Validates the token with the auth server rather than trusting the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = req.nextUrl.pathname;

  if (!user && isPrivateApi(path)) {
    // JSON, not a redirect: a fetch following a 307 to an HTML login page
    // would fail to parse and read as a server fault.
    return NextResponse.json({ error: "Sign in to use this." }, { status: 401 });
  }

  if (!user && isPrivate(path)) {
    const to = req.nextUrl.clone();
    to.pathname = "/login";
    // Come back to where they were headed once signed in.
    to.searchParams.set("next", path);
    return NextResponse.redirect(to);
  }

  if (user && AUTH_PAGES.includes(path)) {
    const to = req.nextUrl.clone();
    to.pathname = "/positions";
    to.search = "";
    return NextResponse.redirect(to);
  }

  return res;
}

export const config = {
  /**
   * Skip static assets and the image optimiser: running an auth round trip for
   * every icon would add latency to every page for no protection.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
