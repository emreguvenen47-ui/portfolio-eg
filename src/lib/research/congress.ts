import type { CongressTrade } from "./alt-data";

/**
 * Congressional trading.
 *
 * The primary records are the House Clerk's and Senate EFD financial
 * disclosures. Both were tested from this deployment:
 *
 *  - House Clerk publishes an annual ZIP that is reachable, but it contains
 *    only filing *metadata* (member, filing type, date, document ID). The
 *    transactions themselves are in per-filing PDFs, and parsing thousands of
 *    scanned PDFs is exactly the fragile scraping this app avoids.
 *  - Senate EFD returns 403 to any programmatic client.
 *  - The structured community mirrors that used to republish both
 *    (house-stock-watcher, senate-stock-watcher) now return AccessDenied.
 *
 * So the seam is complete and the page states the blocker precisely. A
 * provider only has to satisfy `CongressSource` for the page to fill in.
 *
 * Disclosure lag is computed here rather than by a provider so it cannot be
 * omitted: the gap between trading and disclosing is the single most important
 * property of this data, and it is what makes "insider trading" the wrong
 * description — these are legally required, lagged disclosures.
 */

export interface CongressRow extends CongressTrade {
  /** Days between the trade and its disclosure. */
  disclosureLagDays: number | null;
  issuer: string | null;
  sourceUrl: string | null;
  sourceProvider: string;
}

export function withLag(t: CongressTrade & { issuer?: string | null; sourceUrl?: string | null; sourceProvider?: string }): CongressRow {
  const a = Date.parse(t.transactionDate);
  const b = Date.parse(t.disclosureDate);
  return {
    ...t,
    issuer: t.issuer ?? null,
    sourceUrl: t.sourceUrl ?? null,
    sourceProvider: t.sourceProvider ?? "unknown",
    disclosureLagDays:
      Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : null,
  };
}

/** Drop duplicates that arrive from more than one mirror of the same filing. */
export function dedupe(rows: CongressRow[]): CongressRow[] {
  const seen = new Set<string>();
  const out: CongressRow[] = [];
  for (const r of rows) {
    const key = `${r.politician}|${r.ticker}|${r.transactionDate}|${r.side}|${r.valueLow ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export interface CongressSummary {
  window: string;
  buys: number;
  sells: number;
  members: number;
  topBought: { ticker: string; count: number }[];
  topSold: { ticker: string; count: number }[];
  medianLagDays: number | null;
}

const median = (xs: number[]): number | null => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function summarise(rows: CongressRow[], days: number, label: string): CongressSummary {
  const cutoff = Date.now() - days * 86_400_000;
  const w = rows.filter((r) => Date.parse(r.transactionDate) >= cutoff);
  const count = (side: "BUY" | "SELL") => {
    const m = new Map<string, number>();
    for (const r of w.filter((x) => x.side === side)) {
      m.set(r.ticker, (m.get(r.ticker) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([ticker, c]) => ({ ticker, count: c }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  };
  return {
    window: label,
    buys: w.filter((r) => r.side === "BUY").length,
    sells: w.filter((r) => r.side === "SELL").length,
    members: new Set(w.map((r) => r.politician)).size,
    topBought: count("BUY"),
    topSold: count("SELL"),
    medianLagDays: median(w.map((r) => r.disclosureLagDays ?? NaN)),
  };
}

export const CONGRESS_BLOCKER =
  "No structured congressional-disclosure source is reachable from this deployment. The House Clerk's annual archive carries filing metadata only — the transactions themselves are in per-filing PDFs — the Senate EFD returns 403 to programmatic clients, and the community mirrors that used to republish both now return AccessDenied. Rather than parse scanned PDFs of uncertain accuracy, this page reads N/A. Register a CongressSource and it fills in.";

/**
 * Member performance, computed here from real prices rather than taken from a
 * provider.
 *
 * Two separate figures, because they answer different questions: the
 * trade-date return is what the member got, and the disclosure-date return is
 * what someone copying the public filing could have got. The gap between them
 * is the value of the lag.
 */
export interface MemberStats {
  politician: string;
  chamber: string;
  sample: number;
  hitRateVsSpy: number | null;
  medianExcess: Record<"m1" | "m3" | "m6" | "y1", number | null>;
  avgExcess: Record<"m1" | "m3" | "m6" | "y1", number | null>;
  best: { ticker: string; excess: number } | null;
  worst: { ticker: string; excess: number } | null;
  medianLagDays: number | null;
  /** Same measures, started from the disclosure date instead. */
  fromDisclosure: Record<"m1" | "m3" | "m6" | "y1", number | null>;
  /** Below this the numbers are not shown at all. */
  sufficient: boolean;
}

export const MIN_SAMPLE = 5;
