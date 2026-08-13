import type { Facts, MetricKey, Pillar } from "./metrics";
import { HIGHER_IS_BETTER, metricsUsedBy, modelFor } from "./metrics";
import type { Profile, Sector } from "./universe";

/**
 * Sector-relative scoring.
 *
 * Everything here is a percentile against peers, never an absolute threshold.
 * A 22× P/E is expensive for a utility and cheap for a software company, so a
 * fixed cut-off encodes a sector view nobody asked for. Percentiles let each
 * industry set its own bar.
 *
 * Two guards do most of the work:
 *  - a metric with no value is dropped from the pillar, never scored zero
 *  - a candidate below the coverage floor is not ranked at all, because a
 *    score built from two metrics is not comparable to one built from nine
 */

export interface Candidate {
  profile: Profile;
  facts: Facts;
  price: number | null;
  /** Average daily traded value, in the listing currency. */
  dollarVolume: number | null;
}

export interface PeerGroup {
  /** "industry" when there were enough peers, otherwise "sector". */
  basis: "industry" | "sector";
  label: string;
  n: number;
  /** Median per metric across the group. */
  medians: Partial<Record<MetricKey, number>>;
  /** Sorted values per metric, for percentile lookups. */
  values: Partial<Record<MetricKey, number[]>>;
}

/** Fewer than this and an industry is not a peer group, it is an anecdote. */
export const MIN_INDUSTRY_PEERS = 5;
/** Below this share of its sector's metrics, a candidate is not ranked. */
export const MIN_COVERAGE = 0.5;

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Percentile of `v` within a sorted array, 0..100. */
export function percentileOf(sorted: number[], v: number, higherIsBetter: boolean): number {
  if (sorted.length < 2) return 50;
  let below = 0;
  for (const x of sorted) if (x < v) below++;
  const raw = (below / (sorted.length - 1)) * 100;
  return Math.max(0, Math.min(100, higherIsBetter ? raw : 100 - raw));
}

/**
 * Build the peer group for a candidate.
 *
 * Prefers the narrower industry and falls back to the sector, so a niche
 * industry with three members does not produce percentiles from a sample of
 * three. The basis and sample size are returned so the UI can show them.
 */
export function buildPeerGroup(target: Candidate, all: Candidate[]): PeerGroup {
  const sameIndustry = all.filter(
    (c) =>
      c.profile.industry &&
      target.profile.industry &&
      c.profile.industry === target.profile.industry &&
      c.profile.region === target.profile.region,
  );
  const useIndustry = sameIndustry.length >= MIN_INDUSTRY_PEERS;
  const peers = useIndustry
    ? sameIndustry
    : all.filter(
        (c) => c.profile.sector === target.profile.sector && c.profile.region === target.profile.region,
      );

  const keys = metricsUsedBy(target.profile.sector);
  const values: PeerGroup["values"] = {};
  const medians: PeerGroup["medians"] = {};

  for (const k of keys) {
    const xs = peers
      .map((p) => p.facts[k])
      .filter((v): v is number => v !== null && Number.isFinite(v));
    if (xs.length >= 3) {
      values[k] = xs.sort((a, b) => a - b);
      const m = median(xs);
      if (m !== null) medians[k] = m;
    }
  }

  return {
    basis: useIndustry ? "industry" : "sector",
    label: useIndustry ? (target.profile.industry ?? target.profile.sector) : target.profile.sector,
    n: peers.length,
    medians,
    values,
  };
}

// ------------------------------------------------------------------- weights

export type Weights = Record<Pillar, number>;

export const DEFAULT_WEIGHTS: Weights = {
  quality: 20,
  growth: 20,
  valuation: 20,
  profitability: 10,
  balanceSheet: 10,
  momentum: 10,
  sentiment: 5,
  risk: 5,
};

export interface PillarScore {
  pillar: Pillar;
  score: number | null;
  /** Metrics that contributed, with their percentile. */
  parts: { metric: MetricKey; value: number; percentile: number }[];
  /** Metrics the sector uses that had no value. */
  missing: MetricKey[];
}

export interface ScoreResult {
  symbol: string;
  score: number | null;
  pillars: PillarScore[];
  coverage: { have: number; total: number };
  confidence: "HIGH" | "MEDIUM" | "LOW";
  peer: PeerGroup;
  /** Percentile of the overall score within the peer group's scores. */
  industryPercentile: number | null;
  sectorPercentile: number | null;
}

export function scoreCandidate(
  c: Candidate,
  peer: PeerGroup,
  weights: Weights = DEFAULT_WEIGHTS,
): Omit<ScoreResult, "industryPercentile" | "sectorPercentile"> {
  const model = modelFor(c.profile.sector);
  const pillars: PillarScore[] = [];

  let have = 0;
  let total = 0;

  for (const pillar of Object.keys(model) as Pillar[]) {
    const keys = model[pillar];
    const parts: PillarScore["parts"] = [];
    const missing: MetricKey[] = [];

    for (const k of keys) {
      const sorted = peer.values[k];
      // A metric no peer reports is not a differentiator for this group, so it
      // is not counted against anyone. Without this a Borsa İstanbul name is
      // marked down for lacking a figure that no Turkish filer publishes —
      // punishing a company for its exchange's disclosure regime rather than
      // for anything about the business.
      if (!sorted) continue;

      total++;
      const v = c.facts[k];
      if (v === null || !Number.isFinite(v)) {
        missing.push(k);
        continue;
      }
      have++;
      parts.push({ metric: k, value: v, percentile: percentileOf(sorted, v, HIGHER_IS_BETTER[k]) });
    }

    pillars.push({
      pillar,
      // The pillar is the mean of the percentiles that existed. A pillar with
      // nothing behind it is null and drops out of the weighted mean rather
      // than dragging it to zero.
      score: parts.length
        ? Math.round(parts.reduce((s, p) => s + p.percentile, 0) / parts.length)
        : null,
      parts,
      missing,
    });
  }

  const scored = pillars.filter((p) => p.score !== null);
  const weightSum = scored.reduce((s, p) => s + weights[p.pillar], 0);
  const coverageRatio = total > 0 ? have / total : 0;

  const score =
    weightSum > 0 && coverageRatio >= MIN_COVERAGE
      ? Math.round(scored.reduce((s, p) => s + p.score! * weights[p.pillar], 0) / weightSum)
      : null;

  // Confidence is about the evidence, not the verdict: a wide peer group and
  // full coverage is HIGH regardless of whether the score is good or bad.
  const confidence: ScoreResult["confidence"] =
    coverageRatio >= 0.8 && peer.n >= 10 && peer.basis === "industry"
      ? "HIGH"
      : coverageRatio >= MIN_COVERAGE && peer.n >= 5
        ? "MEDIUM"
        : "LOW";

  return {
    symbol: c.facts.symbol,
    score,
    pillars,
    coverage: { have, total },
    confidence,
    peer,
  };
}

// --------------------------------------------------------------- explanation

export interface Explanation {
  likes: string[];
  dislikes: string[];
  triggers: string[];
}

const LABEL: Partial<Record<MetricKey, string>> = {
  revenueGrowth: "Revenue growth",
  epsGrowth: "EPS growth",
  grossMargin: "Gross margin",
  operatingMargin: "Operating margin",
  netMargin: "Net margin",
  fcfMargin: "FCF margin",
  ruleOf40: "Rule of 40",
  roe: "ROE",
  roa: "ROA",
  roic: "ROIC",
  netCashToAssets: "Net cash / assets",
  debtToEquity: "Debt / equity",
  currentRatio: "Current ratio",
  equityToAssets: "Equity / assets",
  interestCover: "Interest cover",
  pe: "P/E",
  forwardPe: "Forward P/E",
  ps: "P/S",
  pb: "P/B",
  evEbitda: "EV/EBITDA",
  evSales: "EV/Sales",
  pFcf: "P/FCF",
  fcfYield: "FCF yield",
  return3m: "3M return",
  return6m: "6M return",
  return12m: "12M return",
  volatility: "Volatility",
  beta: "Beta",
  analystScore: "Analyst consensus",
};

const isPct = (k: MetricKey) =>
  !["pe", "forwardPe", "ps", "pb", "evEbitda", "evSales", "pFcf", "currentRatio", "beta", "analystScore"].includes(k);

const fmt = (k: MetricKey, v: number) =>
  isPct(k) ? `${v.toFixed(1)}%` : `${v.toFixed(2)}×`;

/**
 * Why this name, and why not.
 *
 * Every line names a real peer comparison with its percentile, so the reader
 * can disagree with the specific claim rather than the score. The dislikes are
 * generated from the same data by the same rule — a screener that only lists
 * what it likes is a sales pitch.
 */
export function explain(
  c: Candidate,
  result: Omit<ScoreResult, "industryPercentile" | "sectorPercentile">,
): Explanation {
  const all = result.pillars.flatMap((p) => p.parts);
  const strong = all.filter((p) => p.percentile >= 70).sort((a, b) => b.percentile - a.percentile);
  const weak = all.filter((p) => p.percentile <= 30).sort((a, b) => a.percentile - b.percentile);
  const basis = result.peer.basis;

  const line = (p: { metric: MetricKey; value: number; percentile: number }) => {
    const med = result.peer.medians[p.metric];
    const rel =
      med !== undefined && med !== 0 && HIGHER_IS_BETTER[p.metric]
        ? `, ${(p.value / med).toFixed(1)}× the ${basis} median`
        : med !== undefined && med !== 0
          ? `, ${(((p.value - med) / Math.abs(med)) * 100).toFixed(0)}% ${p.value < med ? "below" : "above"} the ${basis} median`
          : "";
    return `${LABEL[p.metric] ?? p.metric} ${fmt(p.metric, p.value)} — ${p.percentile.toFixed(0)}th ${basis} percentile${rel}.`;
  };

  const likes = strong.slice(0, 5).map(line);
  const dislikes = weak.slice(0, 5).map(line);

  // Deterministic triggers, derived from where the candidate actually sits.
  const triggers: string[] = [];
  const val = result.pillars.find((p) => p.pillar === "valuation");
  const grw = result.pillars.find((p) => p.pillar === "growth");
  const bal = result.pillars.find((p) => p.pillar === "balanceSheet");

  if (val?.score !== null && val && val.score! >= 70) {
    triggers.push(
      `Valuation re-rating toward the ${basis} median would remove the main support for this ranking.`,
    );
  }
  if (grw?.score !== null && grw && grw.score! >= 70) {
    triggers.push(
      `Two consecutive quarters of revenue growth below the ${basis} median would break the growth case.`,
    );
  }
  if (bal?.score !== null && bal && bal.score! <= 30) {
    triggers.push("Leverage falling back toward peer levels would remove the main balance-sheet objection.");
  }
  const mom = result.pillars.find((p) => p.pillar === "momentum");
  if (mom?.score !== null && mom && mom.score! <= 30) {
    triggers.push("Six-month relative strength turning positive would remove the momentum objection.");
  }
  if (result.coverage.have < result.coverage.total) {
    triggers.push(
      `${result.coverage.total - result.coverage.have} of ${result.coverage.total} metrics are missing; fuller reporting could move this either way.`,
    );
  }

  return { likes, dislikes, triggers };
}

export const SECTOR_LIST: Sector[] = [
  "Software",
  "Semiconductors",
  "Technology",
  "Banks",
  "Financials",
  "Healthcare",
  "Industrials",
  "Energy",
  "Consumer",
  "Materials",
  "Utilities",
  "RealEstate",
  "Communication",
  "Other",
];
