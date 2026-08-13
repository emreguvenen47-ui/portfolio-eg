import "server-only";
import { finnhubKey } from "@/lib/providers/finnhub";
import { twelveDataKey } from "@/lib/providers/twelvedata";
import { loadBistUniverse } from "@/lib/providers/bist-universe";

/**
 * The scannable universe.
 *
 * Two separate ideas live here and must not be confused:
 *
 *  - LISTED: every symbol that exists. Around 5,800 US common stocks and 650
 *    BIST names. This drives search and eligibility.
 *  - RANKABLE: the subset with enough cached fundamental data to be scored
 *    against peers. Ranking a company on two metrics next to one scored on
 *    nine is not a comparison, so coverage gates entry rather than being
 *    silently averaged away.
 *
 * Profiles (sector, market cap) come from Finnhub one symbol at a time, which
 * on the free tier means the rankable set grows as the cache warms rather than
 * arriving complete. That is stated in the UI; the alternative — inventing a
 * sector or a market cap — is not acceptable.
 */

const LIST_TTL_MS = 7 * 24 * 60 * 60_000;
const PROFILE_TTL_MS = 7 * 24 * 60 * 60_000;

export type { Region, CapBucket, Sector, Listing, Profile } from "./types";
export { CAP_BUCKET_LABEL, CAP_THRESHOLDS, capBucket, toSector } from "./types";

import type { CapBucket, Listing, Profile, Region, Sector } from "./types";
import { capBucket, toSector } from "./types";

// ------------------------------------------------------------------ listings

const LIST_KEY = Symbol.for("pcc.scanner.listings");
const listCache = globalThis as unknown as Record<
  symbol,
  { at: number; value: Listing[] } | undefined
>;

interface FhSymbol {
  symbol?: string;
  description?: string;
  type?: string;
  currency?: string;
}

/**
 * US listings.
 *
 * Finnhub answers `/stock/symbol` with a redirect to a static JSON file, which
 * `fetch` follows on its own. One call gives the whole exchange.
 */
async function loadUsListings(): Promise<Listing[]> {
  const key = finnhubKey();
  if (!key) return [];
  try {
    const res = await fetch(`https://finnhub.io/api/v1/stock/symbol?exchange=US&token=${key}`, {
      cache: "no-store",
      headers: { "User-Agent": "PortfolioEG/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = (await res.json()) as FhSymbol[];
    return rows
      .filter(
        (r) =>
          r.symbol &&
          r.type === "Common Stock" &&
          // Warrants, units and preferred lines are not what a stock screener
          // is for, and they pollute every percentile they enter.
          !/[.\-]/.test(r.symbol),
      )
      .map((r) => ({
        symbol: r.symbol!.toUpperCase(),
        name: r.description ?? r.symbol!,
        region: "US" as const,
        currency: r.currency ?? "USD",
      }));
  } catch {
    return [];
  }
}

/** Twelve Data as the US fallback when Finnhub's file is unavailable. */
async function loadUsListingsFallback(): Promise<Listing[]> {
  const key = twelveDataKey();
  if (!key) return [];
  const out: Listing[] = [];
  for (const exchange of ["NASDAQ", "NYSE"]) {
    try {
      const res = await fetch(
        `https://api.twelvedata.com/stocks?exchange=${exchange}&country=United%20States&apikey=${key}`,
        { cache: "no-store" },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as { data?: { symbol?: string; name?: string; type?: string; currency?: string }[] };
      for (const r of json.data ?? []) {
        if (!r.symbol || r.type !== "Common Stock" || /[.\-]/.test(r.symbol)) continue;
        out.push({
          symbol: r.symbol.toUpperCase(),
          name: r.name ?? r.symbol,
          region: "US",
          currency: r.currency ?? "USD",
        });
      }
    } catch {
      // Try the next exchange.
    }
  }
  return out;
}

export async function loadUniverse(): Promise<Listing[]> {
  const hit = listCache[LIST_KEY];
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.value;

  const [usPrimary, bist] = await Promise.all([loadUsListings(), loadBistUniverse()]);
  const us = usPrimary.length ? usPrimary : await loadUsListingsFallback();

  const value: Listing[] = [
    ...us,
    ...bist.map((b) => ({
      symbol: b.ticker,
      name: b.companyName,
      region: "BIST" as const,
      currency: b.currency,
    })),
  ];

  if (value.length) listCache[LIST_KEY] = { at: Date.now(), value };
  return value.length ? value : (hit?.value ?? []);
}

// ------------------------------------------------------------------ profiles

const PROFILE_KEY = Symbol.for("pcc.scanner.profiles");
const profiles: Map<string, { at: number; value: Profile | null }> = ((
  globalThis as unknown as Record<symbol, Map<string, { at: number; value: Profile | null }>>
)[PROFILE_KEY] ??= new Map());

interface FhProfile {
  ticker?: string;
  name?: string;
  finnhubIndustry?: string;
  marketCapitalization?: number;
  currency?: string;
}

/**
 * Sector and market cap for one symbol.
 *
 * Cached for a week — an industry classification does not change, and a market
 * cap bucket is stable enough that refetching it daily would spend the request
 * budget for nothing.
 */
export async function getProfile(symbol: string, region: Region): Promise<Profile | null> {
  const key = symbol.trim().toUpperCase();
  const hit = profiles.get(key);
  if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.value;

  const fhKey = finnhubKey();
  if (!fhKey || region === "BIST") {
    // Finnhub has no BIST coverage, so a BIST profile carries no sector or
    // market cap until another source provides one. Recorded as a null profile
    // rather than a guessed one.
    const value = null;
    profiles.set(key, { at: Date.now(), value });
    return value;
  }

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(key)}&token=${fhKey}`,
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const p = (await res.json()) as FhProfile;
    if (!p.ticker) throw new Error("empty profile");

    const marketCap = typeof p.marketCapitalization === "number" ? p.marketCapitalization : null;
    const value: Profile = {
      symbol: key,
      name: p.name ?? key,
      region,
      currency: p.currency ?? "USD",
      industry: p.finnhubIndustry ?? null,
      sector: toSector(p.finnhubIndustry),
      marketCap,
      bucket: capBucket(marketCap, region),
      fetchedAt: new Date().toISOString(),
    };
    profiles.set(key, { at: Date.now(), value });
    return value;
  } catch {
    profiles.set(key, { at: Date.now(), value: null });
    return null;
  }
}

/** Profiles already cached, without triggering any fetch. */
export function cachedProfiles(): Profile[] {
  return [...profiles.values()]
    .map((v) => v.value)
    .filter((p): p is Profile => p !== null);
}

export const profileCacheSize = (): number => profiles.size;
