import type { Sector } from "@/lib/scanner/types";

/**
 * Sector and sub-sector proxies for rotation analysis.
 *
 * Each entry names a liquid ETF that tracks the group. The ETF is the price
 * series; the constituent list for breadth comes from the screener universe by
 * sector, not from the fund's holdings — those are only available for the SSGA
 * funds and using them for some sectors and not others would make breadth
 * incomparable across the table.
 */

export type FlowGroupKind = "sector" | "subsector";

export interface FlowGroup {
  id: string;
  label: string;
  /** ETF or index whose price series represents the group. */
  proxy: string;
  kind: FlowGroupKind;
  /** Our internal sector, for pulling constituents out of the universe. */
  sector: Sector | null;
  /** Narrower match against the provider industry string, for sub-sectors. */
  industryPattern?: RegExp;
  region: "US" | "BIST";
}

export const US_BENCHMARK = "SPY";
export const BIST_BENCHMARK = "XU100";

export const FLOW_GROUPS: FlowGroup[] = [
  // ---------------------------------------------------------------- sectors
  { id: "tech", label: "Technology", proxy: "XLK", kind: "sector", sector: "Technology", region: "US" },
  { id: "comm", label: "Communication Services", proxy: "XLC", kind: "sector", sector: "Communication", region: "US" },
  { id: "discretionary", label: "Consumer Discretionary", proxy: "XLY", kind: "sector", sector: "Consumer", region: "US" },
  { id: "staples", label: "Consumer Staples", proxy: "XLP", kind: "sector", sector: null, region: "US" },
  { id: "financials", label: "Financials", proxy: "XLF", kind: "sector", sector: "Financials", region: "US" },
  { id: "healthcare", label: "Healthcare", proxy: "XLV", kind: "sector", sector: "Healthcare", region: "US" },
  { id: "industrials", label: "Industrials", proxy: "XLI", kind: "sector", sector: "Industrials", region: "US" },
  { id: "energy", label: "Energy", proxy: "XLE", kind: "sector", sector: "Energy", region: "US" },
  { id: "materials", label: "Materials", proxy: "XLB", kind: "sector", sector: "Materials", region: "US" },
  { id: "utilities", label: "Utilities", proxy: "XLU", kind: "sector", sector: "Utilities", region: "US" },
  { id: "realestate", label: "Real Estate", proxy: "XLRE", kind: "sector", sector: "RealEstate", region: "US" },

  // ------------------------------------------------------------ sub-sectors
  { id: "semis", label: "Semiconductors", proxy: "SMH", kind: "subsector", sector: "Semiconductors", region: "US" },
  { id: "software", label: "Software", proxy: "IGV", kind: "subsector", sector: "Software", region: "US" },
  { id: "banks", label: "Banks", proxy: "KBE", kind: "subsector", sector: "Banks", region: "US" },
  { id: "defense", label: "Defense / Aerospace", proxy: "ITA", kind: "subsector", sector: "Industrials", industryPattern: /aerospace|defense/i, region: "US" },
  { id: "biotech", label: "Biotech", proxy: "XBI", kind: "subsector", sector: "Healthcare", industryPattern: /biotech/i, region: "US" },
  { id: "homebuilders", label: "Homebuilders", proxy: "XHB", kind: "subsector", sector: "Industrials", industryPattern: /homebuild|building|construction/i, region: "US" },
  { id: "transport", label: "Transportation", proxy: "IYT", kind: "subsector", sector: "Industrials", industryPattern: /transport|trucking|railroad|air freight|marine/i, region: "US" },
  { id: "metals", label: "Metals & Mining", proxy: "XME", kind: "subsector", sector: "Materials", industryPattern: /metal|mining|steel|aluminum|precious/i, region: "US" },
  { id: "oilgas", label: "Oil & Gas E&P", proxy: "XOP", kind: "subsector", sector: "Energy", industryPattern: /oil|gas/i, region: "US" },
  { id: "retail", label: "Retail", proxy: "XRT", kind: "subsector", sector: "Consumer", industryPattern: /retail|department store/i, region: "US" },
];

export const groupById = (id: string): FlowGroup | undefined =>
  FLOW_GROUPS.find((g) => g.id === id);

export const TIMEFRAMES = [
  { key: "1D", bars: 1 },
  { key: "1W", bars: 5 },
  { key: "1M", bars: 21 },
  { key: "3M", bars: 63 },
  { key: "6M", bars: 126 },
  { key: "1Y", bars: 252 },
] as const;

export type Timeframe = (typeof TIMEFRAMES)[number]["key"];
