import type { MetadataRoute } from "next";

/**
 * Crawl rules.
 *
 * The research pages are public and worth indexing — that is the point of
 * having a link to share. The account-owned pages are listed as disallowed,
 * but that is courtesy rather than the control: middleware redirects an
 * unauthenticated request for any of them to /login, so a crawler cannot fetch
 * their contents whatever it does with this file.
 */
const PRIVATE = [
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
  "/login",
  "/signup",
  "/api/",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE.map((p) => `${p}`) }],
  };
}
