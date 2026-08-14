import "server-only";
import { getHistories } from "@/lib/providers";
import { enqueue, queueDepth } from "@/lib/server/warm-queue";
import { loadScreenerUniverse } from "@/lib/scanner/screener-universe";
import { eligible, type PoolFilters } from "@/lib/scanner/engine";
import { enrichRow, cachedRow, hasRow, rowCacheReady } from "./enrich";
import {
  buildAggregates,
  evaluateScreen,
  metricsInScreen,
  type CriterionResult,
  type Enriched,
  type Screen,
} from "./filter";
import type { Row } from "./metrics";
import { US_BENCHMARK } from "@/lib/rotation/sectors";

/**
 * Run a custom screen.
 *
 * Order is the same discipline the opportunity scanner needed: the universe
 * and size/sector constraints are applied first, and enrichment is spent
 * inside that pool. A small-cap industrials screen never warms mega caps.
 */

/**
 * How many uncached pool members one request hands to the background queue.
 *
 * Nothing here is awaited. Enriching inside the request put a provider
 * allowance directly in front of the response — a cold pool took over a minute
 * to answer while the filtering it gated took milliseconds. The screen now
 * renders from cache and says how many more are coming.
 */
const ENRICH_PER_REQUEST = 120;

export interface ScreenRowOut {
  symbol: string;
  name: string;
  region: string;
  sector: string;
  industry: string | null;
  currency: string;
  marketCap: number | null;
  bucket: string | null;
  price: number | null;
  row: Row;
  /** Metrics with a value, out of those the screen asked for. */
  coverage: { have: number; total: number };
  /**
   * Per-criterion verdict, so a row can say why it is here. A screen that
   * cannot show its working is indistinguishable from one that guessed.
   */
  results: CriterionResult[];
  /** Peer medians for the tested metrics, for context beside each value. */
  peerMedian: { sector: Partial<Record<string, number>>; industry: Partial<Record<string, number>> };
}

export interface ScreenResponse {
  rows: ScreenRowOut[];
  eligible: number;
  dataAvailable: number;
  matches: number;
  analyzing: number;
  universe: number;
  /**
   * Why the non-matches were rejected. Separating a genuine fail from a data
   * gap is the difference between "nothing is cheap right now" and "we could
   * not check" — the UI must be able to say which.
   */
  rejected: { failed: number; noData: number; noPeers: number };
}

export async function runScreen(
  pool: PoolFilters,
  screen: Screen,
): Promise<ScreenResponse> {
  const [universe] = await Promise.all([
    loadScreenerUniverse().catch(() => []),
    rowCacheReady(),
  ]);
  const candidates = eligible(universe, pool);

  // Benchmark once, for relative strength on every row.
  const bench = await getHistories([US_BENCHMARK], 300).catch(
    () => ({}) as Awaited<ReturnType<typeof getHistories>>,
  );
  const benchmark = bench[US_BENCHMARK]?.candles ?? [];

  // Enrich inside the pool, most-traded first.
  const cold = candidates
    .filter((c) => !hasRow(c.symbol))
    .sort((a, b) => (b.dollarVolume ?? 0) - (a.dollarVolume ?? 0));
  const toEnrich = cold.slice(0, ENRICH_PER_REQUEST);

  const needAnalyst = metricsInScreen(screen).includes("analystScore");
  enqueue(
    toEnrich.map((u) => ({
      kind: "screener",
      symbol: u.symbol,
      priority: u.dollarVolume ?? 0,
      run: () => enrichRow(u, { benchmark, needAnalyst }),
    })),
  );

  const enriched: Enriched[] = [];
  const meta = new Map<string, (typeof candidates)[number]>();
  for (const c of candidates) {
    const row = cachedRow(c.symbol);
    if (!row) continue;
    meta.set(c.symbol, c);
    enriched.push({ symbol: c.symbol, sector: c.sector, industry: c.industry, row });
  }

  /**
   * Peer aggregates come from the whole sector, not just the filtered pool.
   * "P/E below the sector median" means the sector's median, and computing it
   * only from small caps would answer a different question than the one asked.
   */
  const keys = metricsInScreen(screen);
  const aggScope: Enriched[] = [];
  for (const u of universe) {
    if (!pool.regions.includes(u.region)) continue;
    const row = cachedRow(u.symbol);
    if (row) aggScope.push({ symbol: u.symbol, sector: u.sector, industry: u.industry, row });
  }
  const agg = buildAggregates(aggScope.length ? aggScope : enriched, keys);

  const out: ScreenRowOut[] = [];
  const rejected = { failed: 0, noData: 0, noPeers: 0 };
  for (const e of enriched) {
    const verdict = evaluateScreen(screen, e, agg);
    if (!verdict.matched) {
      // Attribute the rejection to its most informative cause.
      if (verdict.results.some((r) => r.outcome === "FAIL")) rejected.failed++;
      else if (verdict.results.some((r) => r.outcome === "NO_DATA")) rejected.noData++;
      else if (verdict.results.some((r) => r.outcome === "NO_PEERS")) rejected.noPeers++;
      continue;
    }
    const u = meta.get(e.symbol)!;
    const have = keys.filter((k) => {
      const v = e.row[k];
      return typeof v === "number" && Number.isFinite(v);
    }).length;

    out.push({
      symbol: e.symbol,
      name: u.name,
      region: u.region,
      sector: u.sector,
      industry: u.industry,
      currency: u.currency,
      marketCap: u.marketCap,
      bucket: u.bucket,
      price: u.price,
      row: e.row,
      coverage: { have, total: keys.length },
      results: verdict.results,
      peerMedian: {
        sector: (agg.sectorMedian.get(e.sector) ?? {}) as Partial<Record<string, number>>,
        industry: (agg.industryMedian.get(e.industry ?? "") ?? {}) as Partial<
          Record<string, number>
        >,
      },
    });
  }

  return {
    rows: out,
    eligible: candidates.length,
    dataAvailable: enriched.length,
    matches: out.length,
    analyzing: Math.min(cold.length, queueDepth("screener")),
    universe: universe.length,
    rejected,
  };
}
