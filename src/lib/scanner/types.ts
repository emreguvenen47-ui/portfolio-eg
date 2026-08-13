/**
 * Pure scanner types and constants.
 *
 * Split out of `universe.ts` because that module is `server-only` — it holds
 * provider fetches — while the filter UI needs the same types and bucket
 * labels on the client. Importing the server module from a client component
 * fails the build, so the shared vocabulary lives here with no dependencies.
 */

export type Region = "US" | "BIST";

export type CapBucket = "MICRO" | "SMALL" | "MID" | "LARGE" | "MEGA";

export type Sector =
  | "Software"
  | "Semiconductors"
  | "Technology"
  | "Banks"
  | "Financials"
  | "Healthcare"
  | "Industrials"
  | "Energy"
  | "Consumer"
  | "Materials"
  | "Utilities"
  | "RealEstate"
  | "Communication"
  | "Other";

export interface Listing {
  symbol: string;
  name: string;
  region: Region;
  currency: string;
}

export interface Profile {
  symbol: string;
  name: string;
  region: Region;
  currency: string;
  industry: string | null;
  sector: Sector;
  /** In millions of the listing currency. */
  marketCap: number | null;
  bucket: CapBucket | null;
  fetchedAt: string;
}

export { CAP_THRESHOLDS, CAP_BUCKET_LABEL, classifyMarketCap, classifySector } from "./classify";
import { classifyMarketCap } from "./classify";

/**
 * Back-compat alias. Everything routes through the one canonical classifier in
 * `classify.ts` — there used to be a second copy of the thresholds here, and a
 * size filter is only as trustworthy as its least careful caller.
 */
export const capBucket = (marketCap: number | null, region: Region): CapBucket | null =>
  classifyMarketCap(marketCap, region === "BIST" ? "TRY" : "USD", region);

const INDUSTRY_MAP: [RegExp, Sector][] = [
  [/semiconduct/i, "Semiconductors"],
  [/software|internet|media & internet/i, "Software"],
  [/technology|hardware|electronic|it services/i, "Technology"],
  [/bank/i, "Banks"],
  [/insurance|financial services|asset management|capital markets|diversified financ/i, "Financials"],
  [/pharma|biotech|health|medical|life science/i, "Healthcare"],
  [/aerospace|defense|machinery|industrial|transportation|logistics|construction|building|airline|engineering/i, "Industrials"],
  [/oil|gas|energy|coal|refin/i, "Energy"],
  [/retail|consumer|apparel|food|beverage|restaurant|hotel|leisure|automobiles|household/i, "Consumer"],
  [/chemical|metals|mining|paper|packaging|steel|glass|cement/i, "Materials"],
  [/utilit|electric power|water/i, "Utilities"],
  [/real estate|reit/i, "RealEstate"],
  [/telecom|communication|entertainment|advertis/i, "Communication"],
];

/**
 * Provider industry to our sector.
 *
 * Explicit rather than fuzzy: the sector decides which metrics are even
 * meaningful, so a mis-grouping produces a confidently wrong ranking.
 */
export function toSector(industry: string | null | undefined): Sector {
  if (!industry) return "Other";
  for (const [re, sector] of INDUSTRY_MAP) if (re.test(industry)) return sector;
  return "Other";
}
