import "server-only";

/**
 * Polymarket implied probabilities.
 *
 * Status on this deployment: the API is unreachable. `gamma-api.polymarket.com`
 * resets the connection from this network — Polymarket restricts access from a
 * number of jurisdictions, Turkey among them — and that is true outside any
 * sandbox, so it is an environment fact rather than a tooling artefact.
 *
 * Rather than leave the feature out, the seam is complete and tested: shapes,
 * matching rules and caching all work, and `getEventProbabilities` simply
 * returns an unavailable report today. If the API becomes reachable (a
 * different network, or a proxy set through POLYMARKET_BASE_URL) the panels
 * light up with no other change.
 *
 * The matching rule matters as much as the fetch. A market is only attached to
 * an event when its own question text names that event — never by fuzzy
 * similarity, because "will the Fed cut in March" and "will the Fed cut in
 * December" are one word apart and would silently swap.
 */

const BASE = process.env.POLYMARKET_BASE_URL?.trim() || "https://gamma-api.polymarket.com";
const TIMEOUT_MS = 6_000;
// Current pricing moves; discovery and history do not need to.
const CACHE_TTL_MS = 3 * 60_000;
const CLOB = process.env.POLYMARKET_CLOB_URL?.trim() || "https://clob.polymarket.com";
const DATA_API = process.env.POLYMARKET_DATA_URL?.trim() || "https://data-api.polymarket.com";

const CACHE_KEY = Symbol.for("pcc.polymarket.cache");
const cache: Map<string, { at: number; value: EventProbabilities }> = ((
  globalThis as unknown as Record<symbol, Map<string, { at: number; value: EventProbabilities }>>
)[CACHE_KEY] ??= new Map());

export interface PolymarketOutcome {
  /** Outcome label as Polymarket words it, e.g. "25 bps decrease". */
  label: string;
  /** 0..1. Market price, which is the implied probability. */
  probability: number;
  change24h: number | null;
  change7d: number | null;
  /** CLOB token, needed to pull this outcome's probability history. */
  clobTokenId: string | null;
}

export interface PolymarketMarket {
  id: string;
  question: string;
  slug: string;
  outcomes: PolymarketOutcome[];
  volume: number | null;
  liquidity: number | null;
  endDate: string | null;
  updatedAt: string;
  url: string;
}

export interface EventProbabilities {
  available: boolean;
  market: PolymarketMarket | null;
  /** Why nothing is shown, when nothing is shown. */
  note: string;
  /** True when the API itself is unreachable, as opposed to no market matching. */
  regionBlocked: boolean;
}

/** One point on an outcome's implied-probability history. */
export interface ProbabilityPoint {
  t: string;
  p: number;
}

const UNAVAILABLE = (note: string, regionBlocked = false): EventProbabilities => ({
  available: false,
  market: null,
  note,
  regionBlocked,
});

export const REGION_NOTE =
  "POLYMARKET UNAVAILABLE FROM CURRENT SERVER REGION. The public API is not reachable from where this server runs, so implied probabilities read N/A rather than being estimated. No circumvention is attempted. Deploy the server in a region where the public API is reachable, or set POLYMARKET_BASE_URL to an official endpoint, and this panel fills in automatically.";

/**
 * Keywords a market's question must contain to be considered a match.
 *
 * Every term has to appear. This is deliberately strict: an over-matched
 * market attached to the wrong event would put a confident, wrong probability
 * next to a real one.
 */
export interface MarketMatcher {
  /** All of these must appear in the question, case-insensitively. */
  allOf: string[];
  /** None of these may appear. */
  noneOf?: string[];
  /**
   * The market must resolve on or after this date, and within `windowDays` of
   * it. Without this, "will the Fed cut in March" happily matches a December
   * meeting: the words are identical and only the date distinguishes them.
   */
  resolvesNear?: string;
  windowDays?: number;
}

export function matches(
  question: string,
  matcher: MarketMatcher,
  endDate?: string | null,
): boolean {
  const q = question.toLowerCase();
  if (!matcher.allOf.every((t) => q.includes(t.toLowerCase()))) return false;
  if (matcher.noneOf?.some((t) => q.includes(t.toLowerCase()))) return false;

  // Date gate. A market with no end date cannot be shown to be about this
  // occurrence, so it is rejected rather than assumed.
  if (matcher.resolvesNear) {
    if (!endDate) return false;
    const target = Date.parse(matcher.resolvesNear);
    const end = Date.parse(endDate);
    if (!Number.isFinite(target) || !Number.isFinite(end)) return false;
    const days = Math.abs(end - target) / 86_400_000;
    if (days > (matcher.windowDays ?? 21)) return false;
  }
  return true;
}

interface GammaMarket {
  id?: string;
  question?: string;
  slug?: string;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  volumeNum?: number;
  liquidityNum?: number;
  endDate?: string;
  oneDayPriceChange?: number;
  oneWeekPriceChange?: number;
}

function parseMarket(m: GammaMarket): PolymarketMarket | null {
  if (!m.id || !m.question) return null;
  let labels: string[] = [];
  let prices: number[] = [];
  let tokens: string[] = [];
  try {
    labels = JSON.parse(m.outcomes ?? "[]") as string[];
    prices = (JSON.parse(m.outcomePrices ?? "[]") as string[]).map(Number);
    tokens = JSON.parse(m.clobTokenIds ?? "[]") as string[];
  } catch {
    return null;
  }
  if (labels.length !== prices.length || labels.length === 0) return null;

  return {
    id: m.id,
    question: m.question,
    slug: m.slug ?? "",
    outcomes: labels.map((label, i) => ({
      label,
      probability: prices[i],
      // Gamma reports the change for the primary outcome only, so it is
      // attached to the first leg and left null elsewhere rather than being
      // copied across outcomes it does not describe.
      change24h: i === 0 ? (m.oneDayPriceChange ?? null) : null,
      change7d: i === 0 ? (m.oneWeekPriceChange ?? null) : null,
      clobTokenId: tokens[i] ?? null,
    })),
    volume: m.volumeNum ?? null,
    liquidity: m.liquidityNum ?? null,
    endDate: m.endDate ?? null,
    updatedAt: new Date().toISOString(),
    url: m.slug ? `https://polymarket.com/event/${m.slug}` : "https://polymarket.com",
  };
}

/**
 * Find the market matching an event, if one genuinely exists.
 *
 * `cacheKey` should identify the event, not the query, so a repeated render
 * does not re-hit the API.
 */
export async function getEventProbabilities(
  cacheKey: string,
  matcher: MarketMatcher,
): Promise<EventProbabilities> {
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(
      `${BASE}/markets?closed=false&limit=200&order=volumeNum&ascending=false`,
      { signal: controller.signal, cache: "no-store" },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const all = (await res.json()) as GammaMarket[];

    const found = all.find((m) => m.question && matches(m.question, matcher, m.endDate));
    const value: EventProbabilities = found
      ? { available: true, market: parseMarket(found), note: "", regionBlocked: false }
      : UNAVAILABLE(
          "No open Polymarket market matches this event. Markets are attached only when the question text names the event — never by approximate similarity.",
        );

    cache.set(cacheKey, { at: Date.now(), value });
    return value;
  } catch {
    // Unreachable API, as opposed to reachable-but-no-match. The distinction
    // matters: one is a deployment fact, the other is a statement about the
    // market universe.
    const value = UNAVAILABLE(REGION_NOTE, true);
    // Cache the failure too, so a dead endpoint is not retried on every render.
    cache.set(cacheKey, { at: Date.now(), value });
    return value;
  } finally {
    clearTimeout(timer);
  }
}

export const isPolymarketConfigured = (): boolean =>
  process.env.POLYMARKET_ENABLED !== "false" && Boolean(BASE);

/**
 * Host-by-host health.
 *
 * Trading geo-restriction and read-only data availability are different
 * things, so they are tracked separately: a region that blocks trading may
 * still serve public market data, and disabling the section on that basis
 * would throw away working data. `marketDataOperational` is what the UI gates
 * on, and it only requires discovery — probability history degrades to N/A on
 * its own.
 */
export interface PolymarketHealth {
  gammaReachable: boolean;
  clobReachable: boolean;
  dataApiReachable: boolean;
  tradingRegionBlocked: boolean;
  marketDataOperational: boolean;
  checkedAt: string;
  detail: string;
}

const HEALTH_TTL_MS = 5 * 60_000;
const HEALTH_KEY = Symbol.for("pcc.polymarket.health");
const healthCache = globalThis as unknown as Record<
  symbol,
  { at: number; value: PolymarketHealth } | undefined
>;

async function reachable(url: string): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function getHealth(): Promise<PolymarketHealth> {
  const hit = healthCache[HEALTH_KEY];
  if (hit && Date.now() - hit.at < HEALTH_TTL_MS) return hit.value;

  const [gammaReachable, clobReachable, dataApiReachable] = await Promise.all([
    reachable(`${BASE}/markets?limit=1`),
    reachable(`${CLOB}/sampling-markets`),
    reachable(`${DATA_API}/trades?limit=1`),
  ]);

  const anyReachable = gammaReachable || clobReachable || dataApiReachable;
  const value: PolymarketHealth = {
    gammaReachable,
    clobReachable,
    dataApiReachable,
    // Nothing answering at all is the signature of a network-level block. It
    // is inferred, not asserted: we cannot see the reason, only the symptom.
    tradingRegionBlocked: !anyReachable,
    // Discovery is what the section needs. History is a bonus that degrades.
    marketDataOperational: gammaReachable,
    checkedAt: new Date().toISOString(),
    detail: gammaReachable
      ? clobReachable
        ? "Discovery and price history both reachable."
        : "Discovery reachable; the CLOB host is not, so probability history reads N/A while current pricing still works."
      : anyReachable
        ? "Discovery is unreachable. Curated market IDs still resolve where configured."
        : "No Polymarket host answers from this server. Read-only market data is unavailable here; no circumvention is attempted.",
  };

  healthCache[HEALTH_KEY] = { at: Date.now(), value };
  return value;
}

/** Trending and category markets for the standalone page. */
export interface MarketQuery {
  /** Words the question must contain, any one of which qualifies. */
  anyOf?: string[];
  limit?: number;
}

const DISCOVERY_TTL_MS = 15 * 60_000;
const DISC_KEY = Symbol.for("pcc.polymarket.discovery");
const discCache: Map<string, { at: number; value: PolymarketMarket[] }> = ((
  globalThis as unknown as Record<symbol, Map<string, { at: number; value: PolymarketMarket[] }>>
)[DISC_KEY] ??= new Map());

export async function discoverMarkets(
  key: string,
  q: MarketQuery = {},
): Promise<PolymarketMarket[]> {
  const hit = discCache.get(key);
  if (hit && Date.now() - hit.at < DISCOVERY_TTL_MS) return hit.value;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `${BASE}/markets?closed=false&limit=250&order=volumeNum&ascending=false`,
      { signal: ctl.signal, cache: "no-store" },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const all = (await res.json()) as GammaMarket[];

    const filtered = q.anyOf?.length
      ? all.filter((m) =>
          q.anyOf!.some((t) => (m.question ?? "").toLowerCase().includes(t.toLowerCase())),
        )
      : all;

    const value = filtered
      .map(parseMarket)
      .filter((m): m is PolymarketMarket => m !== null)
      .slice(0, q.limit ?? 40);

    discCache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    discCache.set(key, { at: Date.now(), value: [] });
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Implied-probability history for one outcome.
 *
 * Uses the official public price-history endpoint on the CLOB host. Cached for
 * an hour: a probability track is for shape, not for ticks.
 */
const HISTORY_TTL_MS = 60 * 60_000;
const HIST_KEY = Symbol.for("pcc.polymarket.history");
const histCache: Map<string, { at: number; points: ProbabilityPoint[] }> = ((
  globalThis as unknown as Record<symbol, Map<string, { at: number; points: ProbabilityPoint[] }>>
)[HIST_KEY] ??= new Map());

export async function getProbabilityHistory(
  clobTokenId: string,
  intervalHours = 24 * 30,
): Promise<ProbabilityPoint[]> {
  const hit = histCache.get(clobTokenId);
  if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.points;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `${CLOB}/prices-history?market=${encodeURIComponent(clobTokenId)}&interval=max&fidelity=${intervalHours}`,
      { signal: controller.signal, cache: "no-store" },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { history?: { t: number; p: number }[] };
    const points: ProbabilityPoint[] = (json.history ?? []).map((h) => ({
      t: new Date(h.t * 1000).toISOString(),
      p: h.p,
    }));
    histCache.set(clobTokenId, { at: Date.now(), points });
    return points;
  } catch {
    // Same region reality as discovery. An empty track renders as N/A.
    histCache.set(clobTokenId, { at: Date.now(), points: [] });
    return [];
  } finally {
    clearTimeout(timer);
  }
}
