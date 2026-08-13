import type { AssetClass, PositionValuation, Region } from "@/lib/types";
import { loadingsFor, systematicShare, FACTORS, FACTOR_VOL } from "./config";

/**
 * What-if exposure and risk, computed the same way the real book is.
 *
 * Volatility uses the factor model already in `config` rather than price
 * history, because a hypothetical sleeve has no history to draw on. That makes
 * BEFORE and AFTER directly comparable — both sides run through the identical
 * calculation — at the cost of not matching the covariance-based number on the
 * risk page. The UI says so.
 */

export interface WhatIfPosition {
  code: string;
  name: string;
  weight: number;
  assetClass: AssetClass;
  region: Region;
  /** Annual volatility assumption, 0..1. From the workbook, or a class default. */
  volatility: number;
  currency: string;
  theme: string;
  source: "current" | "added";
}

export interface ExposureBucket {
  label: string;
  weight: number;
}

export interface WhatIfSnapshot {
  volatility: number;
  largestWeight: number;
  effectivePositions: number;
  byAssetClass: ExposureBucket[];
  byRegion: ExposureBucket[];
  byCurrency: ExposureBucket[];
  byTheme: ExposureBucket[];
  stress: { id: string; name: string; impactPct: number }[];
}

/** Class-level volatility fallback for a hand-added sleeve. */
const CLASS_VOL: Record<AssetClass, number> = {
  Equity: 0.17,
  Commodity: 0.2,
  Alternative: 0.12,
  Cash: 0.01,
  Unallocated: 0.01,
};

export const defaultVolatilityFor = (assetClass: AssetClass): number =>
  CLASS_VOL[assetClass] ?? 0.15;

function bucket(
  positions: WhatIfPosition[],
  key: (p: WhatIfPosition) => string,
): ExposureBucket[] {
  const m = new Map<string, number>();
  for (const p of positions) m.set(key(p), (m.get(key(p)) ?? 0) + p.weight);
  return [...m.entries()]
    .map(([label, weight]) => ({ label, weight }))
    .sort((a, b) => b.weight - a.weight);
}

/**
 * Model-implied portfolio volatility from factor loadings.
 *
 * Factors are treated as independent, so portfolio variance is the sum of
 * squared factor exposures plus the idiosyncratic remainder — the same
 * structure the risk page falls back to when there is not enough history.
 */
function modelVolatility(positions: WhatIfPosition[]): number {
  const factorExposure: Record<string, number> = {};
  let idioVar = 0;

  for (const p of positions) {
    const loadings = loadingsFor(p.code, p.assetClass);
    const sys = systematicShare(p.assetClass);
    const norm =
      Math.sqrt(Object.values(loadings).reduce((s, l) => s + (l ?? 0) ** 2, 0)) || 1;

    for (const f of FACTORS) {
      const l = loadings[f];
      if (!l) continue;
      // Scale the loading so the position's total systematic variance matches
      // its own volatility assumption rather than the factor's.
      const contribution = (p.weight * p.volatility * Math.sqrt(sys) * (l / norm)) / FACTOR_VOL[f];
      factorExposure[f] = (factorExposure[f] ?? 0) + contribution;
    }
    idioVar += (p.weight * p.volatility) ** 2 * (1 - sys);
  }

  const factorVar = FACTORS.reduce(
    (s, f) => s + ((factorExposure[f] ?? 0) * FACTOR_VOL[f]) ** 2,
    0,
  );
  return Math.sqrt(factorVar + idioVar);
}

/** Rule-based shocks, mirroring the scenario set used elsewhere in the app. */
const STRESS: { id: string; name: string; byClass?: Partial<Record<AssetClass, number>>; byRegion?: Partial<Record<Region, number>> }[] = [
  {
    id: "us-crash",
    name: "US Equity Crash",
    byClass: { Equity: -0.22, Commodity: -0.08, Cash: 0.002 },
    byRegion: { US: -0.3, Europe: -0.22, EM: -0.25, China: -0.25, Global: -0.24 },
  },
  {
    id: "inflation",
    name: "Inflation Shock",
    byClass: { Equity: -0.12, Commodity: 0.14, Alternative: -0.03 },
  },
  {
    id: "recession",
    name: "Global Recession",
    byClass: { Equity: -0.24, Commodity: -0.18, Alternative: -0.06, Cash: 0.005 },
  },
  {
    id: "usd-weak",
    name: "USD Weakness",
    byClass: { Commodity: 0.09 },
    byRegion: { US: -0.01, Europe: 0.07, EM: 0.1, China: 0.08, Global: 0.04 },
  },
  {
    id: "turkey",
    name: "Turkey Crisis",
    byRegion: { Turkey: -0.35 },
  },
];

function runStress(positions: WhatIfPosition[]) {
  return STRESS.map((s) => {
    let impact = 0;
    for (const p of positions) {
      // Region shocks describe equity-market moves, so they only apply to
      // equity — a T-bill sleeve tagged "US" must not fall 30% in a crash.
      const regionShock = p.assetClass === "Equity" ? s.byRegion?.[p.region] : undefined;
      impact += p.weight * (regionShock ?? s.byClass?.[p.assetClass] ?? 0);
    }
    return { id: s.id, name: s.name, impactPct: impact * 100 };
  });
}

export function snapshot(positions: WhatIfPosition[]): WhatIfSnapshot {
  const total = positions.reduce((s, p) => s + p.weight, 0) || 1;
  const norm = positions.map((p) => ({ ...p, weight: p.weight / total }));
  const hhi = norm.reduce((s, p) => s + p.weight ** 2, 0);

  return {
    volatility: modelVolatility(norm),
    largestWeight: Math.max(0, ...norm.map((p) => p.weight)),
    effectivePositions: hhi > 0 ? 1 / hhi : 0,
    byAssetClass: bucket(norm, (p) => p.assetClass),
    byRegion: bucket(norm, (p) => p.region),
    byCurrency: bucket(norm, (p) => p.currency),
    byTheme: bucket(norm, (p) => p.theme),
    stress: runStress(norm),
  };
}

/** Turn the live book into the simulator's starting state. */
export function fromPortfolio(rows: PositionValuation[]): WhatIfPosition[] {
  return rows.map((r) => ({
    code: r.position.code,
    name: r.position.name,
    weight: r.currentWeight,
    assetClass: r.position.assetClass,
    region: r.position.region,
    volatility: r.position.volatility || defaultVolatilityFor(r.position.assetClass),
    currency: r.position.currencyCode,
    theme: r.position.themes[0] ?? "Untagged",
    source: "current",
  }));
}
