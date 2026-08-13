import type { Facts, MetricKey } from "./metrics";
import type { PeerGroup } from "./score";
import type { Sector } from "./universe";

/**
 * Model-implied fair value.
 *
 * This is NOT a price target and is never described as one. It answers a
 * narrower, checkable question: if this company traded on its peer group's
 * multiple, adjusted for how it actually ranks on growth and quality, what
 * price would that imply?
 *
 * Three rules keep it honest:
 *
 *  1. Only multiples that mean something for the sector are used. A P/E on a
 *     loss-making company and an EV/EBITDA on a bank are both arithmetic
 *     without content.
 *  2. The peer multiple is adjusted within a bounded band. A company in the
 *     90th growth percentile earns a premium, but a capped one — unbounded
 *     premiums are how a screener talks itself into any number it likes.
 *  3. When the methods disagree, the range widens and confidence drops rather
 *     than the disagreement being averaged away.
 */

export type ValuationMethod = "forwardPe" | "pe" | "evEbitda" | "ps" | "pb" | "fcfYield";

export interface MethodResult {
  method: ValuationMethod;
  label: string;
  /** The candidate's own multiple. */
  current: number;
  /** Peer median for the same multiple. */
  peerMedian: number;
  /** Peer median after the growth/quality adjustment. */
  adjustedMultiple: number;
  impliedPrice: number;
  upside: number;
}

export interface FairValue {
  available: boolean;
  methods: MethodResult[];
  low: number | null;
  high: number | null;
  mid: number | null;
  upsideLow: number | null;
  upsideHigh: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  note: string;
}

/** Which multiples are meaningful, by sector. */
const METHODS_BY_SECTOR: Record<Sector, ValuationMethod[]> = {
  Software: ["ps", "forwardPe", "fcfYield"],
  Semiconductors: ["forwardPe", "pe", "evEbitda"],
  Technology: ["forwardPe", "pe", "evEbitda"],
  // A bank is valued on book. EV/EBITDA has no meaning when deposits are the
  // funding, and it is deliberately absent.
  Banks: ["pb", "pe"],
  Financials: ["pb", "pe"],
  Healthcare: ["forwardPe", "pe", "evEbitda"],
  Industrials: ["forwardPe", "pe", "evEbitda"],
  Energy: ["evEbitda", "fcfYield", "pe"],
  Consumer: ["forwardPe", "pe", "evEbitda"],
  Materials: ["evEbitda", "pe"],
  Utilities: ["pe", "evEbitda", "pb"],
  RealEstate: ["pb"],
  Communication: ["forwardPe", "pe", "evEbitda"],
  Other: ["pe", "evEbitda"],
};

const LABEL: Record<ValuationMethod, string> = {
  forwardPe: "Forward P/E",
  pe: "P/E",
  evEbitda: "EV/EBITDA",
  ps: "P/S",
  pb: "P/B",
  fcfYield: "FCF yield",
};

const FACT_KEY: Record<ValuationMethod, MetricKey> = {
  forwardPe: "forwardPe",
  pe: "pe",
  evEbitda: "evEbitda",
  ps: "ps",
  pb: "pb",
  fcfYield: "fcfYield",
};

/**
 * Multiplier applied to the peer median, from where the company ranks on
 * growth and quality.
 *
 * Bounded to ±25%. A company genuinely better than its peers deserves a
 * premium; a model that can award +200% deserves no trust.
 */
function adjustment(growthPct: number | null, qualityPct: number | null): number {
  const parts = [growthPct, qualityPct].filter((p): p is number => p !== null);
  if (!parts.length) return 1;
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  // 50th percentile -> 1.00, 100th -> 1.25, 0th -> 0.75.
  return 1 + ((avg - 50) / 50) * 0.25;
}

export function fairValue(input: {
  facts: Facts;
  sector: Sector;
  price: number | null;
  peer: PeerGroup;
  growthPercentile: number | null;
  qualityPercentile: number | null;
}): FairValue {
  const { facts, sector, price, peer, growthPercentile, qualityPercentile } = input;

  if (price === null || price <= 0) {
    return empty("No current price, so no implied value can be computed.");
  }

  const adj = adjustment(growthPercentile, qualityPercentile);
  const methods: MethodResult[] = [];

  for (const method of METHODS_BY_SECTOR[sector] ?? METHODS_BY_SECTOR.Other) {
    const key = FACT_KEY[method];
    const current = facts[key];
    const peerMedian = peer.medians[key];
    if (current === null || current === undefined || peerMedian === undefined) continue;

    // A negative or zero multiple means the denominator is negative — a
    // loss-making P/E, say. There is no implied price to derive from it.
    if (method !== "fcfYield" && (current <= 0 || peerMedian <= 0)) continue;
    if (method === "fcfYield" && (current <= 0 || peerMedian <= 0)) continue;

    const adjusted = peerMedian * adj;
    // For a yield the relationship inverts: a higher peer yield implies a
    // lower price, so price scales by current/target rather than target/current.
    const impliedPrice =
      method === "fcfYield" ? price * (current / adjusted) : price * (adjusted / current);

    if (!Number.isFinite(impliedPrice) || impliedPrice <= 0) continue;

    methods.push({
      method,
      label: LABEL[method],
      current,
      peerMedian,
      adjustedMultiple: adjusted,
      impliedPrice,
      upside: (impliedPrice / price - 1) * 100,
    });
  }

  if (methods.length === 0) {
    return empty(
      "No valuation multiple that is meaningful for this sector could be compared against a peer median — usually a negative denominator or too few peers reporting it.",
    );
  }

  const prices = methods.map((m) => m.impliedPrice).sort((a, b) => a - b);
  const low = prices[0];
  const high = prices.at(-1)!;
  const mid = prices.length % 2 ? prices[(prices.length - 1) / 2] : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;

  // Spread between the methods, as a share of the midpoint. Wide disagreement
  // is information, so it lowers confidence instead of being smoothed over.
  const spread = mid > 0 ? (high - low) / mid : Infinity;
  const confidence: FairValue["confidence"] =
    methods.length >= 3 && spread < 0.25 && peer.n >= 10
      ? "HIGH"
      : methods.length >= 2 && spread < 0.6
        ? "MEDIUM"
        : "LOW";

  return {
    available: true,
    methods,
    low,
    high,
    mid,
    upsideLow: (low / price - 1) * 100,
    upsideHigh: (high / price - 1) * 100,
    confidence,
    note:
      spread >= 0.6
        ? `The methods disagree by ${(spread * 100).toFixed(0)}% of the midpoint, so the range is wide and confidence is low. Treat it as a sanity check, not a valuation.`
        : `Peer ${peer.basis} median multiples, adjusted ${((adj - 1) * 100).toFixed(0)}% for this company's growth and quality percentiles. Not a price target.`,
  };
}

const empty = (note: string): FairValue => ({
  available: false,
  methods: [],
  low: null,
  high: null,
  mid: null,
  upsideLow: null,
  upsideHigh: null,
  confidence: "LOW",
  note,
});
