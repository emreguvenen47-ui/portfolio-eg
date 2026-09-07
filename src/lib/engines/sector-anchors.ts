import "server-only";
import { classifyCompany, type CompanySnapshot } from "@/lib/data/normalize/company";

/**
 * LIVE SECTOR ANCHORS — valuation-motor improvement (no valuation-specific
 * MCP is connected; the two registered servers, capitol-trades and
 * polymarket, carry no fundamentals/pricing data). Instead of a fixed prior
 * written once from memory, the forward-P/E and EV/EBITDA anchors each
 * valuation model blends against are recomputed from the ACTUAL median
 * multiple the market is paying right now, across the precomputed ~6.9k
 * company universe, bucketed the same way the valuation engine classifies
 * companies. A sector re-rates → its anchor re-rates with it.
 *
 * Falls back to the original static prior per bucket until that bucket has
 * ≥MIN_SAMPLES live company multiples (never a median of 3 companies passed
 * off as a sector consensus). Zero import cycle: opportunities.ts calls
 * `refreshSectorAnchors` after every universe write; this module never
 * imports opportunities.ts back.
 */

type CompanyType = CompanySnapshot["identity"]["companyType"];

const MIN_SAMPLES = 25;

export const STATIC_PE_ANCHOR: Record<CompanyType, number> = {
  BANK: 12,
  INSURANCE: 12,
  REIT: 16,
  SEMICONDUCTOR: 22,
  SAAS: 28,
  ENERGY: 12,
  UTILITY: 17,
  CONSUMER: 20,
  INDUSTRIAL: 18,
  BIOTECH: 20,
  GENERAL: 18,
};

export const STATIC_EV_ANCHOR: Record<CompanyType, number> = {
  BANK: 12,
  INSURANCE: 12,
  REIT: 18,
  SEMICONDUCTOR: 16,
  SAAS: 22,
  ENERGY: 6,
  UTILITY: 12,
  CONSUMER: 12,
  INDUSTRIAL: 12,
  BIOTECH: 12,
  GENERAL: 12,
};

interface UniverseRowLike {
  sector: string | null;
  industry: string | null;
  forwardPe: number | null;
  evToEbitda: number | null;
}

let livePe: Partial<Record<CompanyType, number>> = {};
let liveEv: Partial<Record<CompanyType, number>> = {};
let sampleCounts: Partial<Record<CompanyType, number>> = {};
let updatedAt: string | null = null;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/** Recompute anchors from the current universe snapshot. Cheap (<10ms/7k rows). */
export function refreshSectorAnchors(rows: UniverseRowLike[]): void {
  const peByType = new Map<CompanyType, number[]>();
  const evByType = new Map<CompanyType, number[]>();
  for (const r of rows) {
    const type = classifyCompany(r.sector, r.industry);
    if (r.forwardPe !== null && r.forwardPe > 3 && r.forwardPe < 80) {
      const arr = peByType.get(type) ?? [];
      arr.push(r.forwardPe);
      peByType.set(type, arr);
    }
    if (r.evToEbitda !== null && r.evToEbitda > 1 && r.evToEbitda < 60) {
      const arr = evByType.get(type) ?? [];
      arr.push(r.evToEbitda);
      evByType.set(type, arr);
    }
  }
  const nextPe: Partial<Record<CompanyType, number>> = {};
  const nextEv: Partial<Record<CompanyType, number>> = {};
  const counts: Partial<Record<CompanyType, number>> = {};
  for (const [type, vals] of peByType) {
    counts[type] = vals.length;
    if (vals.length >= MIN_SAMPLES) nextPe[type] = Number(median(vals).toFixed(1));
  }
  for (const [type, vals] of evByType) {
    if (vals.length >= MIN_SAMPLES) nextEv[type] = Number(median(vals).toFixed(1));
  }
  livePe = nextPe;
  liveEv = nextEv;
  sampleCounts = counts;
  updatedAt = new Date().toISOString();
}

export const sectorPeAnchor = (type: CompanyType): number => livePe[type] ?? STATIC_PE_ANCHOR[type];
export const sectorEvAnchor = (type: CompanyType): number => liveEv[type] ?? STATIC_EV_ANCHOR[type];
export const anchorIsLive = (type: CompanyType): boolean => livePe[type] !== undefined;

export function anchorMeta(type: CompanyType) {
  return {
    peAnchor: sectorPeAnchor(type),
    evAnchor: sectorEvAnchor(type),
    live: anchorIsLive(type),
    sampleCount: sampleCounts[type] ?? 0,
    updatedAt,
  };
}
