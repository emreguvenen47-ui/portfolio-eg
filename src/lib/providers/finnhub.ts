import "server-only";
import type { FxRate, HistorySeries, MarketDataProvider, Quote } from "@/lib/types";
import { isSymbolMarketOpen } from "./market-hours";
import { isBistSymbol } from "./bist";

/**
 * Finnhub adapter.
 *
 * Chosen as the primary live source because its free tier is rate limited per
 * MINUTE (60 calls) with no daily credit budget, so a polling dashboard cannot
 * exhaust it the way Twelve Data's 800-credits-per-day allowance gets
 * exhausted. It also serves company and market news, which is what the
 * portfolio-impact panel is built on.
 *
 * Free-tier gaps, handled by leaving these to other providers:
 *  - historical candles are a paid endpoint, so `getHistoricalPrices` throws
 *  - indices (^GSPC) and non-US venues (BIST) are not covered
 */

const BASE = "https://finnhub.io/api/v1";
const TIMEOUT_MS = 8000;
/** Free tier allows 30 requests/second; stay well under it. */
const MAX_CONCURRENCY = 5;

/**
 * Self-imposed ceiling, comfortably under the free tier's 60 calls/minute.
 *
 * The dashboard has several independent consumers — the page bundle, the
 * market scanner and the news sweep — and their bursts overlap. Rather than
 * hand-tuning every poll interval so the sum stays legal, requests draw from
 * one shared per-minute budget and callers degrade to partial results when it
 * runs dry. Tripping the real limit would park the provider entirely.
 */
const CALLS_PER_MINUTE = Number(process.env.FINNHUB_CALLS_PER_MINUTE ?? 45);

/** Timestamps of calls made in the trailing 60s. */
let recentCalls: number[] = [];

function tokensAvailable(): number {
  const cutoff = Date.now() - 60_000;
  recentCalls = recentCalls.filter((t) => t > cutoff);
  return Math.max(0, CALLS_PER_MINUTE - recentCalls.length);
}

/** Reserve one slot. False means the caller must skip this request. */
function takeToken(): boolean {
  if (tokensAvailable() <= 0) return false;
  recentCalls.push(Date.now());
  return true;
}

/** Trailing-minute request count, so the UI can show the headroom. */
export function finnhubUsage(): { used: number; limit: number } {
  const available = tokensAvailable();
  return { used: CALLS_PER_MINUTE - available, limit: CALLS_PER_MINUTE };
}

export class FinnhubError extends Error {
  constructor(
    message: string,
    readonly symbol?: string,
  ) {
    super(message);
    this.name = "FinnhubError";
  }
}

export function finnhubKey(): string | null {
  const k = process.env.FINNHUB_API_KEY?.trim();
  return k && k.length > 10 ? k : null;
}

/**
 * Symbols Finnhub's free tier cannot price. Asking for these wastes a call and
 * returns an empty quote, so the orchestrator should route them elsewhere.
 */
const UNSUPPORTED = /^(SPX|NDX|XU100|DXY|VIX|US2Y|US10Y|XAU\/USD|WTI\/USD)$/i;

export function finnhubSupports(symbol: string): boolean {
  // Borsa İstanbul is not on this plan — the endpoint answers "You don't have
  // access to this resource", which would otherwise look like a transient
  // failure and park the provider.
  if (isBistSymbol(symbol)) return false;
  return !UNSUPPORTED.test(symbol.trim()) && !symbol.includes("/");
}

async function call<T>(path: string, params: Record<string, string>, key: string): Promise<T> {
  if (!takeToken()) {
    // Worded to avoid the orchestrator's rate-limit matcher: this is our own
    // ceiling, not Finnhub's, so the provider must NOT be parked for it.
    throw new FinnhubError("Local per-minute request budget is spent");
  }
  const qs = new URLSearchParams({ ...params, token: key });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}?${qs}`, {
      signal: ctl.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (res.status === 429) throw new FinnhubError("429 rate limit from Finnhub");
    if (res.status === 401 || res.status === 403) {
      throw new FinnhubError("Finnhub rejected the API key (401/403)");
    }
    if (!res.ok) throw new FinnhubError(`HTTP ${res.status} from Finnhub`);
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof FinnhubError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new FinnhubError(`Finnhub timed out after ${TIMEOUT_MS}ms`);
    }
    throw new FinnhubError(err instanceof Error ? err.message : "Unknown Finnhub error");
  } finally {
    clearTimeout(timer);
  }
}

/** Run `fn` over `items` with bounded concurrency. */
async function pooled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

/** `/quote` payload: c=current, d=change, dp=percent, pc=previous close, t=epoch. */
interface FhQuote {
  c?: number;
  d?: number | null;
  dp?: number | null;
  pc?: number;
  t?: number;
}

function mapQuote(symbol: string, q: FhQuote): Quote {
  const price = q.c;
  // Finnhub answers unknown symbols with a 200 and an all-zero body.
  if (typeof price !== "number" || !Number.isFinite(price) || price === 0) {
    throw new FinnhubError(`No price returned for ${symbol}`, symbol);
  }
  const prev = typeof q.pc === "number" && q.pc > 0 ? q.pc : price;
  const change = typeof q.d === "number" ? q.d : price - prev;
  return {
    symbol,
    price,
    previousClose: prev,
    change,
    changePercent:
      typeof q.dp === "number" ? q.dp : prev ? ((price - prev) / prev) * 100 : 0,
    currency: "USD",
    timestamp: q.t ? new Date(q.t * 1000).toISOString() : new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    provider: "finnhub",
    // Venue state decides LIVE vs MARKET_CLOSED; the orchestrator may later
    // downgrade this to STALE if the value is served from cache.
    status: isSymbolMarketOpen(symbol) ? "LIVE" : "MARKET_CLOSED",
  };
}

export function createFinnhubProvider(apiKey: string): MarketDataProvider {
  return {
    name: "finnhub",
    // `/stock/candle` is a paid endpoint.
    supportsHistory: false,

    async getQuote(symbol) {
      if (!finnhubSupports(symbol)) {
        throw new FinnhubError(`${symbol} is not on the Finnhub free tier`, symbol);
      }
      return mapQuote(symbol, await call<FhQuote>("/quote", { symbol }, apiKey));
    },

    async getQuotes(symbols) {
      // `/quote` is one symbol per call, but the free tier's budget is
      // per-minute, so a bounded fan-out is affordable here in a way it is not
      // against a daily-credit provider.
      const supported = symbols.filter(finnhubSupports);
      if (supported.length === 0) {
        throw new FinnhubError("No requested symbol is on the Finnhub free tier");
      }
      const settled = await pooled(supported, MAX_CONCURRENCY, (s) => this.getQuote(s));
      const out: Record<string, Quote> = {};
      supported.forEach((s, i) => {
        const r = settled[i];
        if (r?.status === "fulfilled") out[s] = r.value;
      });
      if (Object.keys(out).length === 0) {
        const first = settled.find((r) => r?.status === "rejected") as
          | PromiseRejectedResult
          | undefined;
        throw new FinnhubError(
          first?.reason instanceof Error ? first.reason.message : "No usable symbols",
        );
      }
      return out;
    },

    async getHistoricalPrices(symbol) {
      // `/stock/candle` moved behind a paid plan; the orchestrator falls
      // through to the next provider rather than silently losing history.
      throw new FinnhubError("Historical candles are not on the Finnhub free tier", symbol);
    },

    async getFxRate(pair): Promise<FxRate> {
      throw new FinnhubError(`FX pair ${pair} is not served by this adapter`);
    },

    async getIndexQuote(symbol) {
      return this.getQuote(symbol);
    },
  } satisfies MarketDataProvider & {
    getHistoricalPrices(symbol: string): Promise<HistorySeries>;
  };
}

// ---------------------------------------------------------------------- news

export interface FinnhubArticle {
  category?: string;
  datetime?: number;
  headline?: string;
  id?: number;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
}

/** Market-wide headlines. One call, regardless of portfolio size. */
export async function fetchMarketNews(apiKey: string): Promise<FinnhubArticle[]> {
  const raw = await call<FinnhubArticle[]>("/news", { category: "general" }, apiKey);
  return Array.isArray(raw) ? raw : [];
}

/** Headlines tagged to one symbol, over the last `days` days. */
export async function fetchCompanyNews(
  apiKey: string,
  symbol: string,
  days = 3,
): Promise<FinnhubArticle[]> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const raw = await call<FinnhubArticle[]>(
    "/company-news",
    { symbol, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    apiKey,
  );
  return Array.isArray(raw) ? raw : [];
}

/** Company news for several symbols, concurrency-bounded. Never throws. */
export async function fetchCompanyNewsBatch(
  apiKey: string,
  symbols: string[],
  days = 3,
): Promise<Record<string, FinnhubArticle[]>> {
  const settled = await pooled(symbols, MAX_CONCURRENCY, (s) =>
    fetchCompanyNews(apiKey, s, days),
  );
  const out: Record<string, FinnhubArticle[]> = {};
  symbols.forEach((s, i) => {
    const r = settled[i];
    if (r?.status === "fulfilled") out[s] = r.value;
  });
  return out;
}
