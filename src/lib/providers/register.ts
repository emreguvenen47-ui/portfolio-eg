import "server-only";
import { registerHoldingsSource } from "./etf-holdings";
import { registerReleaseSource } from "@/lib/events/analogues";
import { registerAltSource } from "@/lib/research/alt-data";
import { registerOwnershipSource } from "./ownership";
import { sec13fSource } from "./sec-13f";
import { fredSource } from "./fred";
import { ssgaHoldingsSource } from "./ssga";
import { usaspendingSource } from "./usaspending";
import { greenhouseSource } from "./greenhouse";
import { registerBistTickers } from "./bist";
import { loadBistUniverse } from "./bist-universe";

/**
 * Wire the concrete providers into their seams.
 *
 * Registration is synchronous and happens at module load. It used to be
 * `void import(...).then(register)`, which raced: the first request after a
 * cold start could reach a seam before its provider had registered, and the
 * panel would render N/A for a source that works perfectly a second later.
 *
 * Only sources verified to return real data from this deployment are wired.
 * The rest stay unregistered, which is what makes their panels read N/A rather
 * than something invented.
 */

const DONE = Symbol.for("pcc.providers.registered");
const g = globalThis as unknown as Record<symbol, boolean | undefined>;

if (!g[DONE]) {
  g[DONE] = true;

  // Economic releases: FRED redistributes BLS, BEA, the Board and the ECB.
  registerReleaseSource(fredSource);

  // ETF holdings: State Street publishes real daily workbooks per fund.
  registerHoldingsSource(ssgaHoldingsSource);

  // Federal awards: USAspending's public API, no key.
  registerAltSource("contracts", usaspendingSource);

  // Job postings: companies' own Greenhouse boards, first-party JSON.
  registerAltSource("hiring", greenhouseSource);

  // Institutional holdings: 13F-HR information tables from SEC EDGAR.
  registerOwnershipSource(sec13fSource);

  // The Borsa İstanbul listing is a network fetch, so it warms in the
  // background. Symbol recognition falls back to the curated list until it
  // lands, which degrades search rather than breaking it.
  void loadBistUniverse()
    .then((rows) => {
      if (rows.length) registerBistTickers(rows.map((r) => r.ticker));
    })
    .catch(() => undefined);
}

export function registerProviders(): void {
  // Kept for callers that import it explicitly; the work happens above.
}
