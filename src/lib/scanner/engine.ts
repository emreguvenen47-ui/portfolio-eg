import "server-only";
import { getHistories, getQuotes } from "@/lib/providers";
import { getFinancials, getMetrics, getRecommendations } from "@/lib/providers/fundamentals";
import { getYahooStatements } from "@/lib/providers/yahoo-fundamentals";
import { ordered } from "@/lib/research/statements";
import { buildFacts } from "./metrics";
import {
  buildPeerGroup,
  explain,
  scoreCandidate,
  DEFAULT_WEIGHTS,
  type Candidate,
  type Explanation,
  type PeerGroup,
  type ScoreResult,
  type Weights,
} from "./score";
import { fairValue, type FairValue } from "./fair-value";
import { diskCache } from "@/lib/server/disk-cache";
import { enqueue, queueDepth } from "@/lib/server/warm-queue";
import { loadScreenerUniverse, type UniverseRow } from "./screener-universe";
import { sweepUniverse, sweepable, USER_PRIORITY_BASE } from "./universe-warmer";
import type { CapBucket, Region, Sector } from "./types";

/**
 * The scan engine — filter first, then rank.
 *
 * The order matters more than anything else here. The previous version scored
 * a pre-warmed set and filtered afterwards, and because warming ran down a
 * hand-written seed list that began with the mega caps, a small-cap query
 * could only ever see companies that were not small caps. Data coverage was
 * silently deciding the universe.
 *
 * Now the pool is built from the user's filters against the full screener
 * universe, and fundamentals are fetched only for symbols that already passed
 * those filters. Coverage limits the number of results; it never changes which
 * companies are eligible.
 */

/**
 * The peer group as the browser sees it.
 *
 * The sorted per-metric value arrays are what percentiles are computed from,
 * and that computation finishes on the server. Shipping them anyway cost 7.3KB
 * per row — two thirds of the payload — repeated identically for every company
 * in the same industry. The client reads the basis and the count; that is what
 * it gets.
 */
export interface PeerSummary {
  basis: "industry" | "sector";
  label: string;
  n: number;
  medians: PeerGroup["medians"];
}

export type ScanScore = Omit<ScoreResult, "peer"> & { peer: PeerSummary };

export interface ScanRow {
  symbol: string;
  name: string;
  region: Region;
  sector: Sector;
  industry: string | null;
  currency: string;
  marketCap: number | null;
  bucket: CapBucket | null;
  price: number | null;
  result: ScanScore;
  explanation: Explanation;
  fair: FairValue;
}

/** Drop the percentile arrays; everything that needed them already ran. */
const trimPeer = (p: PeerGroup): PeerSummary => ({
  basis: p.basis,
  label: p.label,
  n: p.n,
  medians: p.medians,
});

/** The filters that define the pool, applied before any scoring. */
export interface PoolFilters {
  regions: Region[];
  sectors: Sector[];
  industries: string[];
  buckets: CapBucket[];
  minMarketCap: number | null;
  maxMarketCap: number | null;
  minDollarVolume: number | null;
  minPrice: number | null;
}

export const DEFAULT_POOL: PoolFilters = {
  regions: ["US"],
  sectors: [],
  industries: [],
  buckets: [],
  minMarketCap: null,
  maxMarketCap: null,
  minDollarVolume: null,
  minPrice: null,
};

/**
 * Hard filters. Every one is AND, and a row missing the value a filter tests
 * is excluded rather than admitted — "market cap above $2bn" cannot be
 * satisfied by a company whose size is unknown.
 */
export function eligible(rows: UniverseRow[], f: PoolFilters): UniverseRow[] {
  return rows.filter((r) => {
    if (f.regions.length && !f.regions.includes(r.region)) return false;
    if (f.sectors.length && !f.sectors.includes(r.sector)) return false;
    if (f.industries.length) {
      if (!r.industry || !f.industries.includes(r.industry)) return false;
    }
    // SIZE UNKNOWN never satisfies a size filter.
    if (f.buckets.length) {
      if (!r.bucket || !f.buckets.includes(r.bucket)) return false;
    }
    if (f.minMarketCap !== null && (r.marketCap === null || r.marketCap < f.minMarketCap)) {
      return false;
    }
    if (f.maxMarketCap !== null && (r.marketCap === null || r.marketCap > f.maxMarketCap)) {
      return false;
    }
    if (f.minPrice !== null && (r.price === null || r.price < f.minPrice)) return false;
    if (
      f.minDollarVolume !== null &&
      (r.dollarVolume === null || r.dollarVolume < f.minDollarVolume)
    ) {
      return false;
    }
    return true;
  });
}

// ------------------------------------------------------------- candidate cache

const CAND_TTL_MS = 24 * 60 * 60_000;

/**
 * Assembled candidates, kept on disk.
 *
 * Each one costs several metered provider calls, so at the free tier's pace
 * the whole listing takes hours to assemble. Holding that in process memory
 * meant a restart threw it away and the scanner began every session with an
 * empty table — coverage never accumulated. On disk it survives, and the
 * background warmer picks up where it left off.
 */
const candCache = diskCache<Candidate | null>("scanner-candidates", CAND_TTL_MS);

/**
 * How many uncached symbols one request hands to the background queue.
 *
 * The request no longer waits for any of them. Measurement is what forced
 * this: warming inside the request cost 94.8s on a cold small/mid industrials
 * pool while the scoring it gated took 43ms. Results now render from cache and
 * the rest arrives on later polls.
 *
 * The queue is drawn from the filtered pool, so the budget is always spent on
 * companies the user actually asked about — never on warming AAPL for someone
 * who asked for small-cap industrials.
 */
const WARM_PER_REQUEST = 120;

function analystScore(
  recs: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }[] | null,
): number | null {
  const r = recs?.[0];
  if (!r) return null;
  const total = r.strongBuy + r.buy + r.hold + r.sell + r.strongSell;
  if (total === 0) return null;
  const net = (r.strongBuy * 2 + r.buy - r.sell - r.strongSell * 2) / (total * 2);
  return Math.round((net + 1) * 50);
}

/**
 * Assemble one candidate.
 *
 * Size, sector and industry come from the screener row that already passed the
 * filters — never re-derived here, so a candidate cannot drift out of the
 * bucket it was selected for.
 */
async function buildCandidate(row: UniverseRow): Promise<Candidate | null> {
  const symbol = row.symbol;

  const [metrics, secFin, quotes, histories, recs] = await Promise.all([
    getMetrics(symbol).catch(() => null),
    getFinancials(symbol).catch(() => null),
    getQuotes([symbol], { maxAgeMs: 30 * 60_000 }).catch(() => ({}) as Record<string, never>),
    getHistories([symbol], 400).catch(() => ({}) as Record<string, never>),
    getRecommendations(symbol).catch(() => null),
  ]);

  const alt = secFin?.length ? null : await getYahooStatements(symbol).catch(() => null);
  const periods = ordered(alt?.quarterly ?? secFin ?? [], 8);
  const candles =
    (
      histories as Record<
        string,
        { candles?: { date: string; open: number; high: number; low: number; close: number; volume: number }[] }
      >
    )[symbol]?.candles ?? [];
  const quote = (quotes as Record<string, { price?: number } | undefined>)[symbol];
  const price = quote?.price ?? candles.at(-1)?.close ?? row.price ?? null;

  const facts = buildFacts({
    symbol,
    metrics,
    periods,
    candles,
    analystScore: analystScore(recs),
  });

  return {
    profile: {
      symbol,
      name: row.name,
      region: row.region,
      currency: row.currency,
      industry: row.industry,
      sector: row.sector,
      marketCap: row.marketCap,
      bucket: row.bucket,
      fetchedAt: new Date().toISOString(),
    },
    facts,
    price,
    dollarVolume: row.dollarVolume,
  };
}

export interface ScanResponse {
  rows: ScanRow[];
  /** Passed the hard filters. */
  eligible: number;
  /** Of those, how many have fundamentals assembled. */
  analyzed: number;
  /** Of those, how many cleared the coverage floor and were scored. */
  rankable: number;
  /**
   * Still being fetched in the background. Results are already usable; this
   * many more companies will appear on a later poll.
   */
  warming: number;
  universe: number;
  /**
   * Progress of the background listing sweep: how many tradable companies have
   * an assembled record, out of how many exist. This is what makes the scanner
   * feel like it accumulates rather than restarting — the count only goes up,
   * and it survives a restart because the cache is on disk.
   */
  coverage: { assembled: number; tradable: number };
}

const EMPTY_FAIR: FairValue = {
  available: false,
  methods: [],
  low: null,
  high: null,
  mid: null,
  upsideLow: null,
  upsideHigh: null,
  confidence: "LOW",
  note: "Not enough peer-comparable data to value this name.",
};

export async function runScan(
  filters: PoolFilters = DEFAULT_POOL,
  weights: Weights = DEFAULT_WEIGHTS,
): Promise<ScanResponse> {
  const universe = await loadScreenerUniverse().catch(() => []);
  const pool = eligible(universe, filters);

  /**
   * Peer scope is wider than the result pool on purpose.
   *
   * A small-cap industrial should be measured against industrials, not only
   * against other small-cap industrials that happen to be cached. Peers are a
   * valuation reference; they are never returned as results, and the final
   * filter below enforces that.
   */
  const peerScope = universe.filter(
    (r) =>
      filters.regions.includes(r.region) &&
      (filters.sectors.length === 0 || filters.sectors.includes(r.sector)),
  );

  // Warm inside the pool, most-traded first so the names a user is likeliest
  // to care about arrive before the long tail.
  const uncached = pool
    .filter((r) => !candCache.has(r.symbol))
    .sort((a, b) => (b.dollarVolume ?? 0) - (a.dollarVolume ?? 0));

  enqueue(
    uncached.slice(0, WARM_PER_REQUEST).map((r) => ({
      kind: "scanner",
      symbol: r.symbol,
      // Above the background sweep's band: whatever a user is looking at now
      // is fetched before the listing walk gets another slot.
      priority: USER_PRIORITY_BASE + (r.dollarVolume ?? 0),
      run: async () => {
        const c = await buildCandidate(r).catch(() => null);
        candCache.set(r.symbol, c);
      },
    })),
  );

  /**
   * Keep the listing filling in behind this request.
   *
   * Not awaited: it only tops up a queue. Driving it from the scanner request
   * rather than a timer means it runs when the app is in use and stops when it
   * is not, which is the right shape for a metered allowance.
   */
  void sweepUniverse({
    isCovered: (symbol) => candCache.has(symbol),
    build: async (row) => {
      const c = await buildCandidate(row).catch(() => null);
      candCache.set(row.symbol, c);
    },
  }).catch(() => null);

  const poolSymbols = new Set(pool.map((r) => r.symbol));
  const candidates: Candidate[] = [];
  for (const r of pool) {
    const c = candCache.get(r.symbol);
    if (c) candidates.push(c);
  }

  const peerCandidates: Candidate[] = [];
  for (const r of peerScope) {
    const c = candCache.get(r.symbol);
    if (c) peerCandidates.push(c);
  }
  const peerPool = peerCandidates.length >= candidates.length ? peerCandidates : candidates;

  const rows: ScanRow[] = candidates.map((c) => {
    const peer = buildPeerGroup(c, peerPool);
    const base = scoreCandidate(c, peer, weights);
    const growth = base.pillars.find((p) => p.pillar === "growth")?.score ?? null;
    const quality = base.pillars.find((p) => p.pillar === "quality")?.score ?? null;

    return {
      symbol: c.facts.symbol,
      name: c.profile.name,
      region: c.profile.region,
      sector: c.profile.sector,
      industry: c.profile.industry,
      currency: c.profile.currency,
      marketCap: c.profile.marketCap,
      bucket: c.profile.bucket,
      price: c.price,
      result: { ...base, peer: trimPeer(base.peer), industryPercentile: null, sectorPercentile: null },
      explanation: explain(c, base),
      // Valued only after the hard filters and the coverage floor are cleared.
      fair:
        base.score === null
          ? EMPTY_FAIR
          : fairValue({
              facts: c.facts,
              sector: c.profile.sector,
              price: c.price,
              peer,
              growthPercentile: growth,
              qualityPercentile: quality,
            }),
    };
  });

  const scored = rows.filter((r) => r.result.score !== null);
  for (const row of scored) {
    const ind = scored
      .filter((r) => r.industry && r.industry === row.industry)
      .map((r) => r.result.score!);
    const sec = scored.filter((r) => r.sector === row.sector).map((r) => r.result.score!);
    const pct = (xs: number[], v: number) =>
      xs.length < 3 ? null : Math.round((xs.filter((x) => x < v).length / (xs.length - 1)) * 100);
    row.result.industryPercentile = pct(ind, row.result.score!);
    row.result.sectorPercentile = pct(sec, row.result.score!);
  }

  rows.sort((a, b) => (b.result.score ?? -1) - (a.result.score ?? -1));

  // Final assertion of the contract: nothing outside the eligible pool is ever
  // returned, whatever the cache happens to hold.
  const safe = rows.filter((r) => poolSymbols.has(r.symbol));

  return {
    rows: safe,
    eligible: pool.length,
    analyzed: candidates.length,
    rankable: safe.filter((r) => r.result.score !== null).length,
    // What is actually outstanding, not an estimate: the queue knows.
    warming: Math.min(uncached.length, queueDepth("scanner")),
    universe: universe.length,
    coverage: (() => {
      const tradable = sweepable(universe);
      return {
        assembled: tradable.filter((r) => candCache.has(r.symbol)).length,
        tradable: tradable.length,
      };
    })(),
  };
}

/**
 * One symbol, scored against its sector peers.
 *
 * Used by the ticker page, where the user asked for this specific company, so
 * no pool filter applies. The peer group still comes from the shared cache.
 */
export async function scoreOne(symbol: string, region: Region): Promise<ScanRow | null> {
  const key = symbol.trim().toUpperCase();
  const universe = await loadScreenerUniverse().catch(() => []);
  const row = universe.find((r) => r.symbol === key && r.region === region);
  if (!row) return null;

  let c = candCache.get(key) ?? null;
  if (!c) {
    c = await buildCandidate(row).catch(() => null);
    candCache.set(key, c);
  }
  if (!c) return null;

  const peers: Candidate[] = [];
  for (const r of universe) {
    if (r.region !== region || r.sector !== row.sector) continue;
    const cached = candCache.get(r.symbol);
    if (cached) peers.push(cached);
  }
  if (!peers.some((p) => p.facts.symbol === key)) peers.push(c);

  const peer = buildPeerGroup(c, peers);
  const base = scoreCandidate(c, peer);
  const growth = base.pillars.find((p) => p.pillar === "growth")?.score ?? null;
  const quality = base.pillars.find((p) => p.pillar === "quality")?.score ?? null;

  return {
    symbol: key,
    name: c.profile.name,
    region: c.profile.region,
    sector: c.profile.sector,
    industry: c.profile.industry,
    currency: c.profile.currency,
    marketCap: c.profile.marketCap,
    bucket: c.profile.bucket,
    price: c.price,
    result: { ...base, peer: trimPeer(base.peer), industryPercentile: null, sectorPercentile: null },
    explanation: explain(c, base),
    fair:
      base.score === null
        ? EMPTY_FAIR
        : fairValue({
            facts: c.facts,
            sector: c.profile.sector,
            price: c.price,
            peer,
            growthPercentile: growth,
            qualityPercentile: quality,
          }),
  };
}
