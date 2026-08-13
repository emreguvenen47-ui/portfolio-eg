import type { ScanRow } from "./engine";
import type { CapBucket, Region, Sector } from "./types";
import type { Pillar } from "./metrics";

/**
 * Filters and presets.
 *
 * A preset is nothing more than a saved filter configuration — there is no
 * second scoring engine hiding behind "CHEAP QUALITY". That matters because it
 * means every preset is auditable: you can open it, see exactly which pillar
 * floors it sets, and disagree with those rather than with a black box.
 */

export interface ScanFilters {
  regions: Region[];
  sectors: Sector[];
  buckets: CapBucket[];
  minMarketCap: number | null;
  maxMarketCap: number | null;
  minDollarVolume: number | null;
  minPrice: number | null;
  /** Reject anything below this share of its sector's metrics. */
  minCoverage: number;
  /** Per-pillar percentile floors, 0..100. */
  pillarFloors: Partial<Record<Pillar, number>>;
  /** Only names with at least this peer sample. */
  minPeers: number;
  search: string;
}

export const EMPTY_FILTERS: ScanFilters = {
  regions: ["US"],
  sectors: [],
  buckets: [],
  minMarketCap: null,
  maxMarketCap: null,
  minDollarVolume: null,
  minPrice: null,
  minCoverage: 0.5,
  pillarFloors: {},
  minPeers: 5,
  search: "",
};

export interface Preset {
  id: string;
  label: string;
  /** What the preset is actually asking for, in words. */
  description: string;
  filters: Partial<ScanFilters>;
}

export const PRESETS: Preset[] = [
  {
    id: "best-small",
    label: "BEST SMALL CAPS",
    description:
      "Hard-constrained to $300m–$2bn. Ranks within that universe only — a large cap can never appear here, however well it scores.",
    filters: {
      buckets: ["SMALL"],
      minDollarVolume: 2_000_000,
      pillarFloors: { quality: 55, balanceSheet: 45 },
    },
  },
  {
    id: "best-mid",
    label: "BEST MID CAPS",
    description:
      "Hard-constrained to $2bn–$10bn. Ranks within that universe only — a mega cap can never appear here.",
    filters: {
      buckets: ["MID"],
      minDollarVolume: 5_000_000,
      pillarFloors: { quality: 55, growth: 50 },
    },
  },
  {
    id: "cheap-quality",
    label: "CHEAP QUALITY",
    description:
      "Cheap on peer multiples AND profitable with a sound balance sheet. The quality floor is what separates this from a list of things that are cheap for a reason.",
    filters: {
      pillarFloors: { valuation: 65, quality: 60, profitability: 55, balanceSheet: 50 },
    },
  },
  {
    id: "garp",
    label: "GROWTH AT FAIR VALUE",
    description: "Top-third growth without paying a top-third multiple for it.",
    filters: { pillarFloors: { growth: 65, valuation: 50, quality: 50 } },
  },
  {
    id: "undervalued-profitable",
    label: "UNDERVALUED PROFITABLE",
    description: "Below-median multiples with genuinely above-median returns on capital.",
    filters: { pillarFloors: { valuation: 60, profitability: 65 } },
  },
  {
    id: "sector-leaders",
    label: "SECTOR LEADERS",
    description: "Strongest overall standing within the industry, whatever the price.",
    filters: { pillarFloors: { quality: 70, profitability: 65 }, minPeers: 8 },
  },
  {
    id: "improving",
    label: "IMPROVING FUNDAMENTALS",
    description: "Growth and momentum both above median — operating results and price agreeing.",
    filters: { pillarFloors: { growth: 60, momentum: 60 } },
  },
  {
    id: "turnaround",
    label: "TURNAROUND WATCH",
    description:
      "Cheap and beaten down but still solvent. Explicitly speculative: the balance-sheet floor is the only thing separating it from a list of failing companies.",
    filters: { pillarFloors: { valuation: 70, balanceSheet: 50, momentum: 0 } },
  },
];

/**
 * Apply a preset over the user's current filters.
 *
 * Only the fields a preset explicitly sets are overridden — region, sector,
 * industry and size the user chose by hand survive unless the preset names
 * them. `BEST SMALL CAPS` names `buckets`, so it does replace the size choice;
 * `CHEAP QUALITY` does not, so it keeps whatever universe the user was already
 * looking at.
 */
export const applyPreset = (base: ScanFilters, preset: Preset): ScanFilters => ({
  ...base,
  ...preset.filters,
  // Floors are replaced wholesale rather than merged: a preset's thresholds
  // are a complete statement, and leaving a stale floor behind would silently
  // narrow a preset the user thinks they understand.
  pillarFloors: { ...(preset.filters.pillarFloors ?? {}) },
});

/** Fields a preset overrides, so the UI can say which choices it replaced. */
export const presetOverrides = (preset: Preset): (keyof ScanFilters)[] =>
  (Object.keys(preset.filters) as (keyof ScanFilters)[]).filter((k) => k !== "pillarFloors");

/**
 * Apply the filters.
 *
 * A row missing the value a filter tests is excluded rather than admitted:
 * "market cap above $2bn" cannot be satisfied by a company whose market cap is
 * unknown, and quietly letting it through would put unmeasured names in a
 * filtered list.
 */
export function applyFilters(rows: ScanRow[], f: ScanFilters): ScanRow[] {
  const q = f.search.trim().toUpperCase();

  return rows.filter((r) => {
    if (f.regions.length && !f.regions.includes(r.region)) return false;
    if (f.sectors.length && !f.sectors.includes(r.sector)) return false;

    if (f.buckets.length) {
      if (!r.bucket || !f.buckets.includes(r.bucket)) return false;
    }
    if (f.minMarketCap !== null) {
      if (r.marketCap === null || r.marketCap < f.minMarketCap) return false;
    }
    if (f.maxMarketCap !== null) {
      if (r.marketCap === null || r.marketCap > f.maxMarketCap) return false;
    }
    if (f.minPrice !== null) {
      if (r.price === null || r.price < f.minPrice) return false;
    }
    if (f.minCoverage > 0) {
      const ratio = r.result.coverage.total
        ? r.result.coverage.have / r.result.coverage.total
        : 0;
      if (ratio < f.minCoverage) return false;
    }
    if (f.minPeers > 0 && r.result.peer.n < f.minPeers) return false;

    for (const [pillar, floor] of Object.entries(f.pillarFloors)) {
      if (floor === undefined) continue;
      const p = r.result.pillars.find((x) => x.pillar === (pillar as Pillar));
      // A pillar with no score cannot clear a floor.
      if (!p || p.score === null || p.score < floor) return false;
    }

    if (q && !r.symbol.includes(q) && !r.name.toUpperCase().includes(q)) return false;
    return true;
  });
}
