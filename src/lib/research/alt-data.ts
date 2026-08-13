/**
 * Alternative-data seams.
 *
 * Six signals the brief asks for — congressional trading, government
 * contracts, patents, hiring, product pricing and supply-chain dependency —
 * plus the nowcast that combines them. None has a configured provider on this
 * deployment, and none is worth a fragile scraper: a hiring count of unknown
 * vintage or a mis-parsed contract value shown next to filed financials is a
 * liability, not a feature.
 *
 * So each is a complete, typed seam with a registration point and an
 * unavailable state. The nowcast below is fully implemented and tested — it
 * simply reports zero coverage until sources are registered, and the moment
 * one is, it starts producing a real signal with no other change.
 *
 * Nothing in this file calls a model.
 */

export type Trend = "ACCELERATING" | "STABLE" | "DECELERATING" | "N/A";

// ------------------------------------------------------------- congress

export interface CongressTrade {
  politician: string;
  chamber: "House" | "Senate";
  ticker: string;
  side: "BUY" | "SELL";
  transactionDate: string;
  /** Disclosure can lag the trade by up to 45 days by law. */
  disclosureDate: string;
  /** Disclosed as a range, never an exact figure. */
  valueLow: number | null;
  valueHigh: number | null;
}

export interface CongressSource {
  name: string;
  trades(ticker: string): Promise<CongressTrade[]>;
}

// ---------------------------------------------------------- gov contracts

export interface GovContract {
  company: string;
  ticker: string | null;
  agency: string;
  awardDate: string;
  program: string;
  /** Money the government has actually committed. */
  obligatedAmount: number | null;
  /**
   * Ceiling of the vehicle, which may never be spent. Kept apart from the
   * obligation because treating a ceiling as revenue is the standard way this
   * data gets misread.
   */
  potentialAwardAmount: number | null;
  type: string;
  source: string;
}

export interface ContractSource {
  name: string;
  contracts(ticker: string): Promise<GovContract[]>;
}

// --------------------------------------------------------------- patents

export interface PatentActivity {
  granted12m: number | null;
  granted24m: number | null;
  categories: { label: string; count: number }[];
  trend: Trend;
}

export interface PatentSource {
  name: string;
  activity(ticker: string): Promise<PatentActivity | null>;
}

// ---------------------------------------------------------------- hiring

export interface HiringActivity {
  totalOpenings: number | null;
  change30d: number | null;
  change90d: number | null;
  byCategory: { label: string; count: number; change90d: number | null }[];
  trend: Trend;
}

export interface HiringSource {
  name: string;
  hiring(ticker: string): Promise<HiringActivity | null>;
}

// --------------------------------------------------------------- pricing

export interface PricingActivity {
  trackedProducts: number | null;
  avgPriceChange90d: number | null;
  discountFrequencyChange: number | null;
  promotionIntensity: "HIGH" | "MEDIUM" | "LOW" | null;
}

export interface PricingSource {
  name: string;
  pricing(ticker: string): Promise<PricingActivity | null>;
}

export type PricingPower = "IMPROVING" | "STABLE" | "DETERIORATING" | "N/A";

/**
 * Pricing power needs more than a price.
 *
 * A price rise with rising discounts and falling margin is not pricing power —
 * it is list-price inflation being given back at the till. All three legs must
 * agree before the verdict moves, and the reasoning is returned with it.
 */
export function pricingPower(
  p: PricingActivity | null,
  grossMarginChangeBps: number | null,
): { verdict: PricingPower; why: string } {
  if (!p || p.avgPriceChange90d === null) {
    return {
      verdict: "N/A",
      why: "No tracked product pricing is available for this company.",
    };
  }
  const priceUp = p.avgPriceChange90d > 1;
  const priceDown = p.avgPriceChange90d < -1;
  const discountsFalling = (p.discountFrequencyChange ?? 0) < 0;
  const marginUp = (grossMarginChangeBps ?? 0) > 25;

  if (priceUp && discountsFalling && marginUp) {
    return {
      verdict: "IMPROVING",
      why: `Tracked prices ${p.avgPriceChange90d > 0 ? "+" : ""}${p.avgPriceChange90d.toFixed(1)}% over 90 days, discount frequency falling, and gross margin up ${grossMarginChangeBps}bps — all three agree.`,
    };
  }
  if (priceDown || (p.discountFrequencyChange ?? 0) > 10) {
    return {
      verdict: "DETERIORATING",
      why: `Tracked prices ${p.avgPriceChange90d.toFixed(1)}% over 90 days with discounting ${(p.discountFrequencyChange ?? 0) > 0 ? "rising" : "flat"} — price is being given back through promotion.`,
    };
  }
  return {
    verdict: "STABLE",
    why: `Tracked prices ${p.avgPriceChange90d.toFixed(1)}% over 90 days with no consistent shift in discounting or margin.`,
  };
}

// ---------------------------------------------------------- supply chain

export type Dependency = "LOW" | "MEDIUM" | "HIGH";

export interface SupplyEdge {
  from: string;
  to: string;
  relation: "supplier" | "customer" | "manufacturing" | "technology" | "geographic";
  dependency: Dependency;
  /** Required: an edge without a reason is an assertion. */
  why: string;
  source: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

export interface SupplySource {
  name: string;
  edges(ticker: string): Promise<SupplyEdge[]>;
}

// ------------------------------------------------------------- registry

interface Registry {
  congress: CongressSource[];
  contracts: ContractSource[];
  patents: PatentSource[];
  hiring: HiringSource[];
  pricing: PricingSource[];
  supply: SupplySource[];
}

const REGISTRY: Registry = {
  congress: [],
  contracts: [],
  patents: [],
  hiring: [],
  pricing: [],
  supply: [],
};

export function registerAltSource<K extends keyof Registry>(
  kind: K,
  source: Registry[K][number],
): void {
  (REGISTRY[kind] as unknown[]).push(source);
}

export const altCoverage = (): Record<keyof Registry, boolean> => ({
  congress: REGISTRY.congress.length > 0,
  contracts: REGISTRY.contracts.length > 0,
  patents: REGISTRY.patents.length > 0,
  hiring: REGISTRY.hiring.length > 0,
  pricing: REGISTRY.pricing.length > 0,
  supply: REGISTRY.supply.length > 0,
});

/** Congressional disclosures from whichever source is registered. */
export async function getCongressTrades(ticker?: string): Promise<CongressTrade[]> {
  for (const s of REGISTRY.congress) {
    try {
      const r = await s.trades(ticker ?? "");
      if (r.length) return r;
    } catch {
      // Try the next source rather than failing the page.
    }
  }
  return [];
}

/** Hiring activity from whichever source is registered. */
export async function getHiring(ticker: string): Promise<HiringActivity | null> {
  for (const s of REGISTRY.hiring) {
    try {
      const r = await s.hiring(ticker);
      if (r) return r;
    } catch {
      // Try the next source.
    }
  }
  return null;
}

/** Federal awards from whichever contract source is registered. */
export async function getContracts(ticker: string): Promise<GovContract[]> {
  for (const s of REGISTRY.contracts) {
    try {
      const r = await s.contracts(ticker);
      if (r.length) return r;
    } catch {
      // Try the next source rather than failing the page.
    }
  }
  return [];
}

export const ALT_GAP_NOTE =
  "No alternative-data provider is configured. Congressional disclosures, federal contract awards, patent grants, job postings, product pricing and supply-chain relationships all read N/A. These are deliberately not scraped: a figure of unknown vintage displayed beside filed financials is worse than a blank.";

// ---------------------------------------------------------------- nowcast

export interface NowcastInput {
  hiring: HiringActivity | null;
  pricing: PricingActivity | null;
  contracts: GovContract[];
  patents: PatentActivity | null;
  /** Change in analyst consensus score over roughly three months. */
  analystRevision: number | null;
  /** Reported margin change, in basis points, for the counter-argument. */
  grossMarginChangeBps: number | null;
  /** Inventory growth YoY in percent, for the counter-argument. */
  inventoryChangePct: number | null;
}

export interface Nowcast {
  verdict: Trend;
  /** How many of the six inputs had data. */
  coverage: number;
  total: number;
  supporting: string[];
  against: string[];
  note: string;
}

/**
 * Business activity nowcast.
 *
 * Explicitly experimental, and labelled as such wherever it renders. It never
 * produces a revenue or EPS number — the output is a direction with its
 * evidence on both sides, because a signal that only lists what supports it is
 * a sales pitch.
 *
 * Coverage below three inputs returns N/A rather than a direction from one or
 * two readings.
 */
export function nowcast(input: NowcastInput): Nowcast {
  const supporting: string[] = [];
  const against: string[] = [];
  let score = 0;
  let coverage = 0;
  const total = 6;

  if (input.hiring?.change90d != null) {
    coverage++;
    if (input.hiring.change90d > 10) {
      score++;
      supporting.push(`Job openings up ${input.hiring.change90d.toFixed(0)}% over 90 days`);
    } else if (input.hiring.change90d < -10) {
      score--;
      against.push(`Job openings down ${Math.abs(input.hiring.change90d).toFixed(0)}% over 90 days`);
    }
  }

  if (input.pricing?.avgPriceChange90d != null) {
    coverage++;
    if (input.pricing.avgPriceChange90d > 2) {
      score++;
      supporting.push(`Tracked prices up ${input.pricing.avgPriceChange90d.toFixed(1)}%`);
    } else if (input.pricing.avgPriceChange90d < -2) {
      score--;
      against.push(`Tracked prices down ${Math.abs(input.pricing.avgPriceChange90d).toFixed(1)}%`);
    }
  }

  if (input.contracts.length > 0) {
    coverage++;
    const recent = input.contracts.filter(
      (c) => Date.parse(c.awardDate) > Date.now() - 90 * 86_400_000,
    ).length;
    if (recent > 0) {
      score++;
      supporting.push(`${recent} federal contract award${recent === 1 ? "" : "s"} in 90 days`);
    }
  }

  if (input.patents?.trend && input.patents.trend !== "N/A") {
    coverage++;
    if (input.patents.trend === "ACCELERATING") {
      score++;
      supporting.push("Patent grant rate accelerating");
    } else if (input.patents.trend === "DECELERATING") {
      score--;
      against.push("Patent grant rate slowing");
    }
  }

  if (input.analystRevision != null) {
    coverage++;
    if (input.analystRevision > 5) {
      score++;
      supporting.push(`Analyst consensus improved ${input.analystRevision.toFixed(0)} points`);
    } else if (input.analystRevision < -5) {
      score--;
      against.push(`Analyst consensus weakened ${Math.abs(input.analystRevision).toFixed(0)} points`);
    }
  }

  // Margin and inventory always argue the other way when they disagree — the
  // point of the "against" column is that it is populated even when the
  // headline reads positive.
  if (input.grossMarginChangeBps != null || input.inventoryChangePct != null) {
    coverage++;
    if ((input.grossMarginChangeBps ?? 0) < -25) {
      score--;
      against.push(`Gross margin compressed ${Math.abs(input.grossMarginChangeBps!)}bps YoY`);
    } else if ((input.grossMarginChangeBps ?? 0) > 25) {
      score++;
      supporting.push(`Gross margin expanded ${input.grossMarginChangeBps}bps YoY`);
    }
    if ((input.inventoryChangePct ?? 0) > 20) {
      score--;
      against.push(`Inventory up ${input.inventoryChangePct!.toFixed(0)}% YoY`);
    }
  }

  if (coverage < 3) {
    return {
      verdict: "N/A",
      coverage,
      total,
      supporting,
      against,
      note: `Only ${coverage} of ${total} signals had data. A direction from fewer than three inputs would be noise with a label on it.`,
    };
  }

  return {
    verdict: score >= 2 ? "ACCELERATING" : score <= -2 ? "DECELERATING" : "STABLE",
    coverage,
    total,
    supporting,
    against,
    note: "Experimental alternative-data signal. It describes the direction of observable business activity, not revenue or earnings, and it has no track record in this application.",
  };
}
