import "server-only";
import { twelveDataKey } from "./twelvedata";

/**
 * The Borsa İstanbul equity universe.
 *
 * Replaces the hand-written list of ~27 tickers that used to gate BIST search:
 * anything not on that list simply could not be found, which made the feature
 * look broken for most of the exchange. This pulls the full listing from Twelve
 * Data's reference endpoint — around 650 names — and caches it for a week,
 * because exchange membership changes on the order of months, not minutes.
 *
 * The curated list in `bist.ts` is kept and still wins on conflicts: it carries
 * the bank flag and a clean display name, which the reference feed does not.
 * This source fills in everything else.
 */

const TTL_MS = 7 * 24 * 60 * 60_000;
const CACHE_KEY = Symbol.for("pcc.bistUniverse.cache");
const cache = globalThis as unknown as Record<
  symbol,
  { at: number; value: BistListingRow[] } | undefined
>;

export interface BistListingRow {
  /** Canonical ticker as the app uses it: THYAO, never THYAO.IS. */
  ticker: string;
  companyName: string;
  exchange: string;
  currency: string;
  instrumentType: string;
  isActive: boolean;
}

interface TdStock {
  symbol?: string;
  name?: string;
  currency?: string;
  exchange?: string;
  mic_code?: string;
  country?: string;
  type?: string;
}

/**
 * Fold Turkish characters for matching.
 *
 * Someone typing "TUPRAS" must find "Tüpraş", and someone typing "ISBANK"
 * must find "İş Bankası". The dotted and dotless I are the case that matters:
 * a naive `toUpperCase()` in a Turkish locale turns "i" into "İ" and the
 * comparison stops matching.
 */
export function foldTurkish(s: string): string {
  return s
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .replace(/Ş/g, "S")
    .replace(/ş/g, "s")
    .replace(/Ğ/g, "G")
    .replace(/ğ/g, "g")
    .replace(/Ü/g, "U")
    .replace(/ü/g, "u")
    .replace(/Ö/g, "O")
    .replace(/ö/g, "o")
    .replace(/Ç/g, "C")
    .replace(/ç/g, "c")
    .toUpperCase();
}

export async function loadBistUniverse(): Promise<BistListingRow[]> {
  const hit = cache[CACHE_KEY];
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const key = twelveDataKey();
  if (!key) return hit?.value ?? [];

  try {
    const res = await fetch(
      `https://api.twelvedata.com/stocks?exchange=BIST&apikey=${key}`,
      { cache: "no-store", headers: { "User-Agent": "PortfolioEG/1.0" } },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data?: TdStock[] };

    const value: BistListingRow[] = (json.data ?? [])
      .filter((s) => s.symbol && s.mic_code === "XIST")
      .map((s) => ({
        // Reference tickers arrive bare; strip a suffix defensively so the
        // canonical form is guaranteed regardless of feed changes.
        ticker: s.symbol!.trim().toUpperCase().replace(/\.IS$/, ""),
        companyName: (s.name ?? "").trim(),
        exchange: "BIST",
        currency: s.currency ?? "TRY",
        instrumentType: s.type ?? "Common Stock",
        isActive: true,
      }));

    if (value.length === 0) throw new Error("empty universe");
    cache[CACHE_KEY] = { at: Date.now(), value };
    return value;
  } catch {
    // Serve the previous pull rather than emptying search on one blip.
    return hit?.value ?? [];
  }
}

/** Cached snapshot without triggering a fetch. */
export const cachedBistUniverse = (): BistListingRow[] => cache[CACHE_KEY]?.value ?? [];

export interface BistSearchHit {
  ticker: string;
  companyName: string;
  sector: string | null;
  isBank: boolean;
}

/**
 * Search the full universe by ticker or company name.
 *
 * Ticker prefix matches rank first, then name matches, so typing "THY" puts
 * THYAO above any company with "thy" buried in its name.
 */
export function searchUniverse(
  universe: BistListingRow[],
  query: string,
  limit = 10,
): BistListingRow[] {
  const q = foldTurkish(query.trim());
  if (!q) return [];

  const exact: BistListingRow[] = [];
  const prefix: BistListingRow[] = [];
  const nameHit: BistListingRow[] = [];

  for (const row of universe) {
    const t = row.ticker;
    if (t === q) exact.push(row);
    else if (t.startsWith(q)) prefix.push(row);
    else if (foldTurkish(row.companyName).includes(q)) nameHit.push(row);
  }

  return [...exact, ...prefix, ...nameHit].slice(0, limit);
}
