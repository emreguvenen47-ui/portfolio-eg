import "server-only";
import type { DataStatus, FxRate, HistorySeries, MarketDataProvider, Quote } from "@/lib/types";
import { createTwelveDataProvider } from "./twelvedata";
import { createYahooProvider } from "./yahoo";
import { createFinnhubProvider, finnhubKey, finnhubSupports } from "./finnhub";
import { cnbcSupports, createCnbcProvider } from "./cnbc";
import { createNasdaqProvider } from "./nasdaq";
import { createErApiProvider } from "./erapi";
import { refund, remainingToday, trySpend } from "./budget";
import { anyMarketOpen, isSymbolMarketOpen } from "./market-hours";
import { isBistSymbol } from "./bist";

/**
 * Provider orchestration.
 *
 * Real data only. There is no generated-price fallback anywhere on this path:
 * if no provider can price a symbol we return nothing for it and the UI shows
 * UNAVAILABLE. A plausible invented number is worse than a visible gap,
 * because only one of the two can be noticed.
 *
 * When a refresh fails but we still hold a real quote, that quote is served
 * and stamped STALE — which is also what stops the UI flickering every time a
 * poll lands on a rate-limited request.
 */

/**
 * Refresh cadence: 120 seconds for current quotes.
 *
 * Historical candles are on their own, much longer clock (below) — a 2-minute
 * quote refresh must not drag 800 daily bars per symbol along with it.
 *
 * A closed venue stretches the interval: the last print cannot move, so
 * re-fetching it only spends request budget.
 */
const OPEN_QUOTE_TTL_MS = Number(process.env.QUOTE_TTL_MS ?? 120_000);
const CLOSED_QUOTE_TTL_MS = Number(process.env.QUOTE_TTL_CLOSED_MS ?? 900_000);
const HISTORY_TTL_MS = 6 * 60 * 60_000;
/** How long a failed history lookup is remembered before we try again. */
const HISTORY_RETRY_MS = 10 * 60_000;

/** True when any venue we track is trading. Per-venue detail: `market-hours`. */
export function marketOpenNow(): boolean {
  return anyMarketOpen();
}

/** How long a quote stays good. Drives both server caching and client polling. */
export function quoteTtlMs(): number {
  return marketOpenNow() ? OPEN_QUOTE_TTL_MS : CLOSED_QUOTE_TTL_MS;
}

/**
 * Cadence for symbols only the credit-metered provider can price.
 *
 * Rare now that CNBC covers the indices, yields and futures, but a symbol that
 * falls through to Twelve Data must not run at 120s: at one credit per symbol
 * that would spend the whole 800/day allowance in an afternoon.
 */
// Sized so that even if Yahoo never recovers and Twelve Data carries all ~11
// of these alone, a full day costs roughly 480 credits against its 800/day
// allowance: 6.5 open hours at six refreshes an hour, plus overnight at four.
const SLOW_OPEN_TTL_MS = Number(process.env.SLOW_QUOTE_TTL_MS ?? 600_000);
const SLOW_CLOSED_TTL_MS = Number(process.env.SLOW_QUOTE_TTL_CLOSED_MS ?? 4 * 3_600_000);

function slowTtlMs(): number {
  return marketOpenNow() ? SLOW_OPEN_TTL_MS : SLOW_CLOSED_TTL_MS;
}

/**
 * Per-symbol refresh interval.
 *
 * Two axes: how expensive the symbol is to fetch (Finnhub-servable symbols are
 * cheap, the metered-only indices are not) and whether ITS OWN venue is open.
 * BIST closes at 15:00 UTC while US equities are mid-session, so a single
 * global "market open" flag would keep re-fetching a frozen BIST print.
 */
function ttlForSymbol(symbol: string): number {
  const open = isSymbolMarketOpen(symbol);
  // Finnhub (ETFs) and CNBC (indices, yields, futures, FX) are both keyless of
  // any daily budget, so everything they cover runs on the 120s clock. Only
  // symbols left to the metered provider fall back to the slow one.
  const unmetered = finnhubSupports(symbol) || cnbcSupports(symbol);
  if (unmetered) return open ? OPEN_QUOTE_TTL_MS : CLOSED_QUOTE_TTL_MS;
  return open ? SLOW_OPEN_TTL_MS : SLOW_CLOSED_TTL_MS;
}

/** How long a stale value stays servable before the symbol reads UNAVAILABLE. */
const STALE_MAX_MS = 12 * 60 * 60_000;

type CacheEntry<T> = { value: T; freshUntil: number; storedAt: number };

/**
 * Module state lives on `globalThis`.
 *
 * Next evaluates this module more than once per process — server components
 * and route handlers get separate instances, and dev-mode HMR adds more. With
 * plain module-level state each instance keeps its own cache and its own
 * health record, so `/api/status` reported OFFLINE while the page that had
 * just rendered live prices held a perfectly healthy record of its own. One
 * shared bag of state fixes both the wrong badge and the duplicated fetching.
 */
interface ProviderState {
  cache: Map<string, CacheEntry<unknown>>;
  inflight: Map<string, Promise<unknown>>;
  cooldownUntil: Map<string, { until: number; reason: string }>;
  throttleStreak: Map<string, number>;
  /** symbol -> provider that last returned a usable quote for it. */
  symbolProvider: Map<string, string>;
  health: ProviderHealth;
}

const GLOBAL_KEY = Symbol.for("pcc.providers.state");

function providerState(): ProviderState {
  const g = globalThis as unknown as Record<symbol, ProviderState | undefined>;
  g[GLOBAL_KEY] ??= {
    cache: new Map(),
    inflight: new Map(),
    cooldownUntil: new Map(),
    throttleStreak: new Map(),
    symbolProvider: new Map(),
    health: {
      status: "UNAVAILABLE",
      feed: "OFFLINE",
      provider: "none",
      reason: "No market data fetched yet",
      lastSuccessAt: null,
      updatedAt: new Date(0).toISOString(),
    },
  };
  return g[GLOBAL_KEY]!;
}

const cache = providerState().cache;

/** Deduplicates concurrent refreshes of the same key within one process. */
const inflight = providerState().inflight;

function readCache<T>(key: string): { value: T; fresh: boolean; age: number } | null {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (!hit) return null;
  const now = Date.now();
  if (now - hit.storedAt > STALE_MAX_MS) {
    cache.delete(key);
    return null;
  }
  return { value: hit.value, fresh: now < hit.freshUntil, age: now - hit.storedAt };
}

function writeCache<T>(key: string, value: T, ttl: number): void {
  cache.set(key, { value, freshUntil: Date.now() + ttl, storedAt: Date.now() });
}

async function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// ------------------------------------------------------------------ providers

/** Rate-limit cooldowns, keyed by provider name. */
const cooldownUntil = providerState().cooldownUntil;
/** Consecutive throttles per provider, so repeat offences back off further. */
const throttleStreak = providerState().throttleStreak;

/** 1m, 2m, 5m, 15m — then hold at 15m until the provider answers again. */
const BACKOFF_MS = [60_000, 120_000, 300_000, 900_000];

const reasonOf = (e: unknown): string =>
  e instanceof Error ? e.message : "Unknown provider error";

function nextUtcMidnight(): number {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

/**
 * Park a provider that told us to back off. Daily-quota exhaustion is parked
 * until the quota resets; a per-minute trip is parked for a minute. Without
 * this we would keep hammering an endpoint that can only answer 429, and every
 * one of those failures is a chance for a symbol to lose its price entirely.
 */
function noteFailure(provider: string, err: unknown): void {
  const msg = reasonOf(err);
  const daily = /run out of API credits|daily limit|credits for the day/i.test(msg);
  const throttled = daily || /429|rate limit|too many requests/i.test(msg);
  if (!throttled) return;

  // Back off further each time we come back and get throttled again: retrying
  // into an active rate limit is what keeps the limit active.
  const streak = (throttleStreak.get(provider) ?? 0) + 1;
  throttleStreak.set(provider, streak);
  const wait = BACKOFF_MS[Math.min(streak - 1, BACKOFF_MS.length - 1)];

  cooldownUntil.set(provider, {
    until: daily ? nextUtcMidnight() : Date.now() + wait,
    reason: msg,
  });
}

function noteSuccess(provider: string): void {
  throttleStreak.delete(provider);
  cooldownUntil.delete(provider);
}

function isCoolingDown(provider: string): boolean {
  const cd = cooldownUntil.get(provider);
  if (!cd) return false;
  if (Date.now() >= cd.until) {
    cooldownUntil.delete(provider);
    return false;
  }
  return true;
}

export interface ResolvedProvider {
  /** Live providers in preference order; empty only if all are unavailable. */
  chain: MarketDataProvider[];
  /** True when at least one live provider is usable right now. */
  configured: boolean;
  twelveDataKeyPresent: boolean;
  finnhubKeyPresent: boolean;
}

/** Providers billed per request against a daily allowance. */
const METERED = new Set(["twelvedata"]);

let yahooSingleton: MarketDataProvider | null = null;
let cnbcSingleton: MarketDataProvider | null = null;
let nasdaqSingleton: MarketDataProvider | null = null;
let erApiSingleton: MarketDataProvider | null = null;
let twelveSingleton: { key: string; provider: MarketDataProvider } | null = null;
let finnhubSingleton: { key: string; provider: MarketDataProvider } | null = null;

export function resolveProvider(): ResolvedProvider {
  const tdKey = process.env.TWELVE_DATA_API_KEY?.trim();
  const twelveDataKeyPresent = Boolean(tdKey && tdKey.length > 10);
  const fhKey = finnhubKey();

  yahooSingleton ??= createYahooProvider();
  cnbcSingleton ??= createCnbcProvider();
  nasdaqSingleton ??= createNasdaqProvider();
  erApiSingleton ??= createErApiProvider();
  if (twelveDataKeyPresent && twelveSingleton?.key !== tdKey) {
    twelveSingleton = { key: tdKey as string, provider: createTwelveDataProvider(tdKey as string) };
  }
  if (fhKey && finnhubSingleton?.key !== fhKey) {
    finnhubSingleton = { key: fhKey, provider: createFinnhubProvider(fhKey) };
  }
  const twelve = twelveDataKeyPresent ? (twelveSingleton?.provider ?? null) : null;
  const finnhub = fhKey ? (finnhubSingleton?.provider ?? null) : null;

  // Nasdaq is appended last as a history-only source: its quote methods throw
  // so the quote walk passes straight over it, but it keeps the price charts
  // working when Yahoo is throttled and Twelve Data's credits are spent.
  //
  // Requested fallback order: Finnhub, then Twelve Data, then Yahoo. CNBC sits
  // after those three because it is the only keyless source for indices,
  // yields and futures — without it those symbols read UNAVAILABLE whenever
  // Twelve Data's daily credits are spent and Yahoo is throttling, which on a
  // free stack is the common case rather than the edge case. The keyless FX
  // fixing stays last so a currency pair still resolves to a real rate.
  const preference = (process.env.MARKET_PROVIDER ?? "auto").trim().toLowerCase();
  const ordered =
    preference === "twelvedata"
      ? [twelve, finnhub, yahooSingleton, cnbcSingleton, erApiSingleton, nasdaqSingleton]
      : preference === "yahoo"
        ? [yahooSingleton, cnbcSingleton, erApiSingleton, nasdaqSingleton]
        : preference === "finnhub"
          ? [finnhub, yahooSingleton, cnbcSingleton, erApiSingleton, nasdaqSingleton]
          : [finnhub, twelve, yahooSingleton, cnbcSingleton, erApiSingleton, nasdaqSingleton];

  const chain = ordered
    .filter((p): p is MarketDataProvider => Boolean(p))
    .filter((p) => !isCoolingDown(p.name))
    .filter((p) => !METERED.has(p.name) || remainingToday(p.name) > 0);

  return {
    chain,
    configured: chain.length > 0,
    twelveDataKeyPresent,
    finnhubKeyPresent: Boolean(fhKey),
  };
}

/**
 * Which provider last answered for a given symbol.
 *
 * Tried first on the next refresh. Two symbols in the same request often want
 * different sources — Finnhub prices QQQ but not ^GSPC — and without this the
 * chain re-discovers that from scratch every cycle, paying a guaranteed
 * failure (and, for Twelve Data, a reserved credit) before reaching the source
 * that actually works.
 */
function preferredProviderFor(symbol: string): string | undefined {
  // Yahoo is the only configured source carrying Borsa İstanbul listings —
  // Finnhub and Twelve Data both reject them on this plan — so pin BIST names
  // rather than burning a metered credit discovering that on every request.
  if (isBistSymbol(symbol)) return "yahoo";
  return providerState().symbolProvider.get(symbol);
}

function rememberProviderFor(symbol: string, provider: string): void {
  providerState().symbolProvider.set(symbol, provider);
}

/** Order the chain so each symbol's last-known-good provider is tried first. */
function chainForSymbols(chain: MarketDataProvider[], symbols: string[]): MarketDataProvider[] {
  const preferred = new Set(
    symbols.map(preferredProviderFor).filter((p): p is string => Boolean(p)),
  );
  if (preferred.size === 0) return chain;
  return [...chain].sort((a, b) => Number(preferred.has(b.name)) - Number(preferred.has(a.name)));
}

/**
 * Run one provider operation, charging metered providers up front.
 *
 * Reserving `credits` BEFORE the call (and refunding on failure) is what makes
 * the cap a real ceiling: charging afterwards would let a single oversized
 * batch punch straight through it.
 */
async function runCharged<T>(
  p: MarketDataProvider,
  credits: number,
  op: (p: MarketDataProvider) => Promise<T>,
): Promise<T> {
  const metered = METERED.has(p.name);
  if (metered && !trySpend(p.name, credits)) {
    throw new Error(
      `${p.name} daily budget exhausted (${credits} credits needed, ${remainingToday(p.name)} left)`,
    );
  }
  try {
    return await op(p);
  } catch (e) {
    if (metered) refund(p.name, credits);
    throw e;
  }
}

// -------------------------------------------------------------------- health

/**
 * Feed state, as distinct from data status.
 *
 * `status` describes the DATA (live, closed-market, stale, or absent);
 * `feed` describes the CONNECTION (are we still getting refreshes). They come
 * apart exactly when it matters: an out-of-hours quote is `DELAYED` data on a
 * perfectly healthy `LIVE` feed, and a real price we can no longer refresh is
 * `DELAYED` data on a `STALE` feed.
 */
export type FeedState = "LIVE" | "STALE" | "OFFLINE";

export interface ProviderHealth {
  status: DataStatus;
  feed: FeedState;
  provider: string;
  reason?: string;
  /** Last time a live provider actually answered. */
  lastSuccessAt: string | null;
  updatedAt: string;
}

function recordHealth(patch: Partial<ProviderHealth>): void {
  const st = providerState();
  st.health = { ...st.health, ...patch, updatedAt: new Date().toISOString() };
}

/** Current state, derived from what the last fetch actually did. Free. */
export function getProviderHealth(): ProviderHealth {
  return providerState().health;
}

// -------------------------------------------------------------------- helpers

/**
 * Walk the provider chain until one answers. Failures are recorded (which may
 * trip a cooldown) and we move on rather than surfacing the error.
 */
async function tryChain<T>(
  op: (p: MarketDataProvider) => Promise<T>,
  credits = 1,
  filter?: (p: MarketDataProvider) => boolean,
): Promise<{ value: T; provider: string } | { error: string }> {
  const chain = resolveProvider().chain.filter((p) => filter?.(p) ?? true);
  let lastError = "No live market data provider available";
  for (const p of chain) {
    try {
      const value = await runCharged(p, credits, op);
      noteSuccess(p.name);
      return { value, provider: p.name };
    } catch (e) {
      lastError = `${p.name}: ${reasonOf(e)}`;
      // Provider failures are swallowed by design, so log them: otherwise a
      // silently missing price looks like a bug in the analytics.
      console.warn(`[market] ${lastError}`);
      noteFailure(p.name, e);
    }
  }
  return { error: lastError };
}

/** Mark a value we are serving from cache after a failed refresh. */
function asStale<T extends { status: DataStatus; fallbackReason?: string }>(
  value: T,
  ageMs: number,
  reason: string,
): T {
  const seconds = Math.round(ageMs / 1000);
  return {
    ...value,
    status: "STALE",
    fallbackReason: `Last real price ${seconds}s ago — refresh failed (${reason})`,
  };
}

// -------------------------------------------------------------------- quotes

/**
 * Ask each provider in turn for whatever is still missing, rather than
 * stopping at the first one that answers.
 *
 * No single free source covers this portfolio: Finnhub prices US ETFs but not
 * indices, BIST or FX; Yahoo covers those. First-success-wins would have
 * silently left SPX and USD/TRY unpriced forever.
 */
async function fetchQuotesAcrossChain(symbols: string[]): Promise<{
  quotes: Record<string, Quote>;
  providers: string[];
  error?: string;
}> {
  const { chain } = resolveProvider();
  const quotes: Record<string, Quote> = {};
  const providers: string[] = [];
  let remaining = symbols;
  let lastError = "No live market data provider available";

  for (const p of chainForSymbols(chain, symbols)) {
    if (remaining.length === 0) break;
    const batch = remaining;
    try {
      // Metered providers are charged one credit per symbol requested.
      const got = await runCharged(p, batch.length, (prov) => prov.getQuotes(batch));
      const covered = Object.keys(got);
      if (covered.length === 0) throw new Error("Returned no symbols");
      Object.assign(quotes, got);
      for (const s of covered) rememberProviderFor(s, p.name);
      providers.push(p.name);
      noteSuccess(p.name);
      remaining = batch.filter((s) => !quotes[s]);
    } catch (e) {
      lastError = `${p.name}: ${reasonOf(e)}`;
      console.warn(`[market] ${lastError}`);
      noteFailure(p.name, e);
    }
  }

  return {
    quotes,
    providers,
    error: remaining.length ? lastError : undefined,
  };
}

/** Null when no real provider can price the symbol — never a generated quote. */
export async function getQuote(symbol: string): Promise<Quote | null> {
  const quotes = await getQuotes([symbol]);
  return quotes[symbol] ?? null;
}

export interface QuoteOptions {
  /**
   * Oldest cached value this caller will accept, in ms. Callers that do not
   * need price-tick freshness (the market scanner sweeps ~35 tickers that are
   * not held) pass a large value and reuse whatever the portfolio refresh
   * already fetched, instead of buying their own copy every cycle.
   *
   * This is a READ policy. It never extends how long a value looks fresh to
   * anyone else, so a wide sweep cannot stale out the portfolio's own prices.
   */
  maxAgeMs?: number;
}

export async function getQuotes(
  symbols: string[],
  opts: QuoteOptions = {},
): Promise<Record<string, Quote>> {
  const wanted = [...new Set(symbols.filter(Boolean))];
  if (wanted.length === 0) return {};

  const out: Record<string, Quote> = {};
  const stale: Record<string, { value: Quote; age: number }> = {};
  const missing: string[] = [];

  for (const s of wanted) {
    // Each symbol has its own acceptable age: fast for anything an unmetered
    // source can price, slow for the metered-only indices and FX.
    const maxAge = Math.max(opts.maxAgeMs ?? 0, ttlForSymbol(s));
    const hit = readCache<Quote>(`q:${s}`);
    if (hit && hit.age <= maxAge) out[s] = hit.value;
    else {
      missing.push(s);
      if (hit) stale[s] = { value: hit.value, age: hit.age };
    }
  }
  // Everything was still fresh — health already describes that same fetch, so
  // leave its timestamp alone rather than claiming a refresh that never ran.
  if (missing.length === 0) return out;

  // One in-flight refresh per symbol set, so N concurrent page renders issue
  // one upstream fetch rather than N.
  const key = `q:batch:${missing.slice().sort().join(",")}`;
  const result = await dedupe(key, () => fetchQuotesAcrossChain(missing));

  for (const [k, v] of Object.entries(result.quotes)) {
    out[k] = v;
    writeCache(`q:${k}`, v, ttlForSymbol(k));
  }

  if (result.providers.length) {
    recordHealth({
      status: aggregateStatus(Object.values(result.quotes)),
      feed: "LIVE",
      provider: result.providers.join("+"),
      reason: undefined,
      lastSuccessAt: new Date().toISOString(),
    });
  } else {
    // Nothing answered for THIS batch. That is not the same as the feed being
    // down: batches are per-symbol-set, so an index-only sweep failing while
    // the portfolio's own ETFs refreshed fine must not stamp the whole feed
    // OFFLINE. Degrade to STALE while a recent success stands, and reserve
    // OFFLINE for having genuinely nothing live.
    const prior = providerState().health;
    const lastOk = prior.lastSuccessAt ? Date.parse(prior.lastSuccessAt) : 0;
    const recentlyOk = lastOk > 0 && Date.now() - lastOk < STALE_MAX_MS;
    const holdingRealPrices =
      recentlyOk || missing.some((s) => stale[s]) || Object.keys(out).length > 0;

    recordHealth({
      status: holdingRealPrices ? "STALE" : "UNAVAILABLE",
      feed: holdingRealPrices ? "STALE" : "OFFLINE",
      provider: recentlyOk ? prior.provider : "none",
      reason: result.error,
    });
  }

  // Anything the live providers did not cover falls back to the last REAL
  // quote we hold, stamped STALE. Symbols with no cached quote are simply
  // absent from the result — the caller renders UNAVAILABLE rather than a
  // number nobody can source.
  const reason = result.error ?? "Symbol not returned by any provider";
  for (const s of missing.filter((x) => !out[x])) {
    const s0 = stale[s];
    if (s0) out[s] = asStale(s0.value, s0.age, reason);
  }

  return out;
}

// ------------------------------------------------------------------- history

export async function getHistoricalPrices(
  symbol: string,
  outputsize = 800,
): Promise<HistorySeries> {
  const cacheKey = `h:${symbol}:${outputsize}`;
  const hit = readCache<HistorySeries>(cacheKey);
  if (hit?.fresh) return hit.value;

  const result = await dedupe(cacheKey, () =>
    tryChain(
      async (p) => {
        const h = await p.getHistoricalPrices(symbol, { outputsize });
        if (h.candles.length < 10) throw new Error("Too few candles returned");
        return h;
      },
      1,
      // Finnhub and the FX source have no candle endpoint at all; asking them
      // just to watch it throw costs a chain walk on every uncached symbol.
      (p) => p.supportsHistory !== false,
    ),
  );

  if ("value" in result) {
    writeCache(cacheKey, result.value, HISTORY_TTL_MS);
    return result.value;
  }
  if (hit) return asStale(hit.value, hit.age, result.error);

  // No real history and nothing cached: return an empty series rather than a
  // generated one. Analytics already handle an empty candle list by falling
  // back to the workbook's own volatility assumptions.
  const empty: HistorySeries = {
    symbol,
    candles: [],
    status: "UNAVAILABLE",
    fallbackReason: result.error,
  };
  // Remember the miss briefly so an unservable symbol does not re-walk the
  // whole chain on every single page render.
  writeCache(cacheKey, empty, HISTORY_RETRY_MS);
  return empty;
}

/**
 * Bulk history, cached per symbol.
 *
 * Providers that expose `getHistories` answer the whole list in one request;
 * for the rest this degrades to sequential per-symbol calls. It is NOT a
 * `Promise.all` fan-out — issuing one request per holding at once is what got
 * us rate-limited by the upstream feed in the first place.
 */
export async function getHistories(
  symbols: string[],
  outputsize = 800,
): Promise<Record<string, HistorySeries>> {
  const wanted = [...new Set(symbols.filter(Boolean))];
  if (wanted.length === 0) return {};

  const out: Record<string, HistorySeries> = {};
  const stale: Record<string, { value: HistorySeries; age: number }> = {};
  const missing: string[] = [];

  for (const s of wanted) {
    const hit = readCache<HistorySeries>(`h:${s}:${outputsize}`);
    if (hit?.fresh) out[s] = hit.value;
    else {
      missing.push(s);
      if (hit) stale[s] = { value: hit.value, age: hit.age };
    }
  }
  if (missing.length === 0) return out;

  const key = `h:batch:${outputsize}:${missing.slice().sort().join(",")}`;
  const result = await dedupe(key, () =>
    tryChain(
      async (p) => {
        const batch = await p.getHistories!(missing, { outputsize });
        if (Object.keys(batch).length === 0) throw new Error("No history returned");
        return batch;
      },
      1,
      (p) => typeof p.getHistories === "function",
    ),
  );

  if ("value" in result) {
    for (const [k, v] of Object.entries(result.value)) {
      out[k] = v;
      writeCache(`h:${k}:${outputsize}`, v, HISTORY_TTL_MS);
    }
  }

  // Anything the bulk call skipped falls back to a single-symbol fetch, which
  // reuses the same cache and stale-serving rules.
  for (const s of missing.filter((x) => !out[x])) {
    const s0 = stale[s];
    if (s0) {
      out[s] = asStale(s0.value, s0.age, "error" in result ? result.error : "not in batch");
      continue;
    }
    out[s] = await getHistoricalPrices(s, outputsize);
  }

  return out;
}

/**
 * Intraday bars for the 1D / 5D chart ranges.
 *
 * Cached far more briefly than daily candles — a 1D series genuinely changes
 * during the session, whereas a five-year series does not change between page
 * views. Null when no provider offers intraday for this symbol.
 */
const INTRADAY_TTL_MS = Number(process.env.INTRADAY_TTL_MS ?? 120_000);

/**
 * Histories already in cache, without triggering a fetch for the rest.
 *
 * Lets a caller render from what it has and queue the misses instead of
 * holding the response open behind several hundred round trips.
 */
export function cachedHistories(
  symbols: string[],
  outputsize = 800,
): { have: Record<string, HistorySeries>; missing: string[] } {
  const have: Record<string, HistorySeries> = {};
  const missing: string[] = [];
  for (const s of [...new Set(symbols.filter(Boolean))]) {
    const hit = readCache<HistorySeries>(`h:${s}:${outputsize}`);
    if (hit) have[s] = hit.value;
    else missing.push(s);
  }
  return { have, missing };
}

export async function getIntraday(
  symbol: string,
  range: "1D" | "5D",
): Promise<HistorySeries | null> {
  const cacheKey = `i:${symbol}:${range}`;
  const hit = readCache<HistorySeries>(cacheKey);
  if (hit?.fresh) return hit.value;

  const result = await dedupe(cacheKey, () =>
    tryChain(
      async (p) => {
        const h = await p.getIntraday!(symbol, range);
        if (h.candles.length < 2) throw new Error("Too few intraday points");
        return h;
      },
      1,
      (p) => typeof p.getIntraday === "function",
    ),
  );

  if ("value" in result) {
    writeCache(cacheKey, result.value, INTRADAY_TTL_MS);
    return result.value;
  }
  // Serve the previous intraday pull rather than an empty chart on one blip.
  return hit?.value ?? null;
}

// ------------------------------------------------------------------------ fx

/** Null when no provider can price the pair. Never a generated rate. */
export async function getFxRate(pair: string): Promise<FxRate | null> {
  const cacheKey = `fx:${pair}`;
  const hit = readCache<FxRate>(cacheKey);
  if (hit?.fresh) return hit.value;

  // Twelve Data bills exchange_rate plus a quote lookup for the daily change.
  const result = await dedupe(cacheKey, () => tryChain((p) => p.getFxRate(pair), 2));

  if ("value" in result) {
    // FX has no unmetered intraday source, so it lives on the slow clock.
    writeCache(cacheKey, result.value, slowTtlMs());
    return result.value;
  }
  if (hit) return asStale(hit.value, hit.age, result.error);
  return null;
}

export async function getIndexQuote(symbol: string): Promise<Quote | null> {
  return getQuote(symbol);
}

/**
 * Worst status across a set of quotes — drives the global header badge.
 *
 * MARKET_CLOSED does not count as a degradation: overnight, every quote in the
 * book is a closed-market print and that is the correct, healthy state.
 */
export function aggregateStatus(quotes: (Quote | null | undefined)[]): DataStatus {
  let sawStale = false;
  let sawLive = false;
  let sawClosed = false;
  for (const q of quotes) {
    if (!q) continue;
    if (q.status === "STALE") sawStale = true;
    else if (q.status === "LIVE") sawLive = true;
    else if (q.status === "MARKET_CLOSED") sawClosed = true;
  }
  if (sawStale) return "STALE";
  if (sawLive) return "LIVE";
  if (sawClosed) return "MARKET_CLOSED";
  return "UNAVAILABLE";
}

