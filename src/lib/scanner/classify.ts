import type { CapBucket, Region, Sector } from "./types";

/**
 * The single canonical market-cap classifier.
 *
 * Everything in the scanner routes through this. There used to be two paths —
 * one in the profile loader and one in the candidate builder — and a size
 * filter is only as trustworthy as its least careful caller.
 *
 * UNITS: absolute currency, not millions. The provider that reports millions
 * converts at its own boundary. Mixing the two silently moves every threshold
 * by a factor of a million, which is exactly the kind of bug a size filter
 * cannot survive.
 */

/** US thresholds, in dollars, as stated in the product spec. */
const US_THRESHOLDS: { bucket: CapBucket; min: number }[] = [
  { bucket: "MEGA", min: 200_000_000_000 },
  { bucket: "LARGE", min: 10_000_000_000 },
  { bucket: "MID", min: 2_000_000_000 },
  { bucket: "SMALL", min: 300_000_000 },
  { bucket: "MICRO", min: 0 },
];

/**
 * BIST thresholds, in lira, set against the actual distribution of the
 * exchange. Borsa İstanbul's largest company is a fraction of a US mega-cap,
 * so converting the dollar ladder would file nearly the whole exchange under
 * MICRO and make the filter useless.
 */
const BIST_THRESHOLDS: { bucket: CapBucket; min: number }[] = [
  { bucket: "MEGA", min: 400_000_000_000 },
  { bucket: "LARGE", min: 100_000_000_000 },
  { bucket: "MID", min: 25_000_000_000 },
  { bucket: "SMALL", min: 5_000_000_000 },
  { bucket: "MICRO", min: 0 },
];

export const CAP_THRESHOLDS: Record<Region, { bucket: CapBucket; min: number }[]> = {
  US: US_THRESHOLDS,
  BIST: BIST_THRESHOLDS,
};

/**
 * Classify a market cap.
 *
 * Returns null — meaning SIZE UNKNOWN — when the figure is missing or
 * nonsensical. A null is never treated as SMALL or MID: a company whose size
 * we do not know is excluded from a size filter rather than guessed into one.
 */
export function classifyMarketCap(
  marketCap: number | null | undefined,
  currency: string,
  market: Region,
): CapBucket | null {
  if (marketCap === null || marketCap === undefined) return null;
  if (!Number.isFinite(marketCap) || marketCap <= 0) return null;

  // The ladder is chosen by market, not by currency string: a BIST listing is
  // measured in lira whatever the provider labels the field.
  void currency;
  for (const t of CAP_THRESHOLDS[market]) {
    if (marketCap >= t.min) return t.bucket;
  }
  return "MICRO";
}

export const CAP_BUCKET_LABEL: Record<Region, Record<CapBucket, string>> = {
  US: {
    MEGA: "≥ $200bn",
    LARGE: "$10–200bn",
    MID: "$2–10bn",
    SMALL: "$300m–2bn",
    MICRO: "< $300m",
  },
  BIST: {
    MEGA: "≥ ₺400bn",
    LARGE: "₺100–400bn",
    MID: "₺25–100bn",
    SMALL: "₺5–25bn",
    MICRO: "< ₺5bn",
  },
};

/**
 * Nasdaq's sector strings mapped to our model sectors.
 *
 * Its `sector` is coarse ("Technology", "Finance") while `industry` is
 * granular ("Semiconductors", "Major Banks"), so industry is consulted first —
 * it is what decides whether a name is scored on gross margin or on book
 * value, and getting that wrong produces a confidently wrong ranking.
 */
const INDUSTRY_RULES: [RegExp, Sector][] = [
  [/semiconductor/i, "Semiconductors"],
  [/computer software|prepackaged software|software|internet|edp services/i, "Software"],
  [/bank|savings institution/i, "Banks"],
  [/insurance|investment manager|finance companies|investment bankers|brokers|real estate investment trust/i, "Financials"],
  [/biotechnolog|pharmaceutic|medical|health|hospital|diagnostic/i, "Healthcare"],
  [/computer manufactur|electronic component|electrical product|telecommunications equipment|computer peripheral/i, "Technology"],
  [/aerospace|defense|machinery|industrial|engineering|construction|building|transportation|airline|trucking|railroad|marine/i, "Industrials"],
  [/oil|gas|coal|energy|petroleum|pipeline/i, "Energy"],
  [/retail|apparel|food|beverage|restaurant|hotel|leisure|auto|consumer|home furnish|department store|package goods/i, "Consumer"],
  [/chemical|metal|mining|steel|paper|forest|containers|packaging|aluminum|precious/i, "Materials"],
  [/utilit|power|water supply|natural gas distribution/i, "Utilities"],
  [/real estate/i, "RealEstate"],
  [/telecommunication|broadcasting|cable|publishing|advertis|movies|entertainment/i, "Communication"],
];

const SECTOR_RULES: [RegExp, Sector][] = [
  [/technology/i, "Technology"],
  [/finance/i, "Financials"],
  [/health/i, "Healthcare"],
  [/industrial/i, "Industrials"],
  [/energy/i, "Energy"],
  [/consumer/i, "Consumer"],
  [/basic materials/i, "Materials"],
  [/utilities/i, "Utilities"],
  [/real estate/i, "RealEstate"],
  [/telecommunication/i, "Communication"],
];

export function classifySector(
  industry: string | null | undefined,
  sector: string | null | undefined,
): Sector {
  if (industry) {
    for (const [re, s] of INDUSTRY_RULES) if (re.test(industry)) return s;
  }
  if (sector) {
    for (const [re, s] of SECTOR_RULES) if (re.test(sector)) return s;
  }
  return "Other";
}
