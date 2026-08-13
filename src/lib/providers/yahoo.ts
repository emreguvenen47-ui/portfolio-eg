import "server-only";
import type { Candle, FxRate, HistorySeries, MarketDataProvider, Quote } from "@/lib/types";
import { isSymbolMarketOpen } from "./market-hours";
import { isBistSymbol, toBistYahoo } from "./bist";

/**
 * Yahoo Finance chart adapter.
 *
 * Why this exists: the Twelve Data free tier is 800 credits/day and a batch
 * quote costs one credit PER SYMBOL, so a ~25-symbol portfolio burns the whole
 * daily allowance in about half an hour of polling. Yahoo's public chart
 * endpoint needs no key and has no per-day credit budget, so it is the default
 * source and Twelve Data becomes the fallback.
 *
 * Batch quotes go through `/v7/finance/spark`, which serves the same `meta`
 * block for many symbols in ONE request (unlike `/v7/finance/quote`, which is
 * 401 for unauthenticated callers). That keeps a full portfolio refresh at a
 * single outbound request instead of one per holding.
 */

const CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const SPARK_URL = "https://query1.finance.yahoo.com/v7/finance/spark";
const TIMEOUT_MS = 8000;
// Yahoo 429s unauthenticated clients that fan out too wide at once.
const MAX_CONCURRENCY = 4;

/**
 * User agent for Yahoo requests.
 *
 * Deliberately short. Yahoo rate-limits by user agent as well as by IP, and
 * the full Chrome/125 fingerprint this used to send is one it now answers with
 * a blanket 429 — verified side by side from the same address at the same
 * moment: the long Chrome string returned 429 while a plain `Mozilla/5.0`
 * returned 200. That was the cause of the chronic "Yahoo is throttled"
 * outages, and it is not an IP problem, so waiting never fixed it.
 *
 * Anything identifying works; `curl/...` does not.
 */
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) PortfolioEG/1.0";

export class YahooError extends Error {
  constructor(
    message: string,
    readonly symbol?: string,
  ) {
    super(message);
    this.name = "YahooError";
  }
}

/**
 * App symbol -> Yahoo symbol. Anything not listed is passed through, which is
 * correct for US-listed ETFs (QQQ, SMH, SGOV, ...) since those tickers match.
 */
const SYMBOL_MAP: Record<string, string> = {
  SPX: "^GSPC",
  NDX: "^NDX",
  XU100: "XU100.IS",
  DXY: "DX-Y.NYB",
  VIX: "^VIX",
  US10Y: "^TNX",
  // Yahoo has no ^-prefixed 2Y series; the CBOT 2-Year Yield future tracks it.
  US2Y: "2YY=F",
  // XAUUSD=X is delisted on Yahoo, so front-month COMEX gold stands in.
  "XAU/USD": "GC=F",
  "WTI/USD": "CL=F",
  "BRENT/USD": "BZ=F",
  "XAG/USD": "SI=F",
};

/** Yields and futures are quoted, not "traded" in the ETF sense. */
const SYNTHETIC = new Set(["US2Y", "US10Y", "VIX", "DXY"]);

export function toYahooSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  const mapped = SYMBOL_MAP[s];
  if (mapped) return mapped;
  // Borsa İstanbul equities carry an `.IS` suffix on Yahoo. This is the only
  // place that suffix exists — users type and read the plain BIST ticker.
  if (isBistSymbol(s)) return toBistYahoo(s);
  // Generic FX pair: "EUR/USD" -> "EURUSD=X".
  const fx = s.match(/^([A-Z]{3})\/([A-Z]{3})$/);
  if (fx) return `${fx[1]}${fx[2]}=X`;
  return s;
}

interface ChartMeta {
  symbol?: string;
  currency?: string;
  regularMarketPrice?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  regularMarketTime?: number;
  instrumentType?: string;
}

interface ChartResult {
  meta?: ChartMeta;
  timestamp?: number[];
  indicators?: {
    quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[];
    adjclose?: { adjclose?: (number | null)[] }[];
  };
}

interface ChartResponse {
  chart?: {
    result?: ChartResult[] | null;
    error?: { code?: string; description?: string } | null;
  };
}

async function chart(symbol: string, range: string, interval: string): Promise<ChartResult> {
  const yahooSymbol = toYahooSymbol(symbol);
  const qs = new URLSearchParams({ range, interval, includePrePost: "false" });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${CHART_BASE}/${encodeURIComponent(yahooSymbol)}?${qs}`, {
      signal: ctl.signal,
      cache: "no-store",
      // Yahoo rejects requests without a browser-ish UA.
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) {
      throw new YahooError(`HTTP ${res.status} from Yahoo for ${yahooSymbol}`, symbol);
    }
    const json = (await res.json()) as ChartResponse;
    const err = json.chart?.error;
    if (err) throw new YahooError(err.description ?? err.code ?? "Yahoo error", symbol);
    const result = json.chart?.result?.[0];
    if (!result) throw new YahooError(`No data for ${symbol} (${yahooSymbol})`, symbol);
    return result;
  } catch (err) {
    if (err instanceof YahooError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new YahooError(`Yahoo timed out after ${TIMEOUT_MS}ms`, symbol);
    }
    throw new YahooError(err instanceof Error ? err.message : "Unknown Yahoo error", symbol);
  } finally {
    clearTimeout(timer);
  }
}

/** Run `jobs` with bounded concurrency so Yahoo does not throttle us. */
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

function closesOf(r: ChartResult): number[] {
  const raw = r.indicators?.quote?.[0]?.close ?? [];
  return raw.filter((c): c is number => typeof c === "number" && Number.isFinite(c));
}

function quoteFrom(symbol: string, r: ChartResult): Quote {
  const meta = r.meta ?? {};
  const closes = closesOf(r);
  const price = meta.regularMarketPrice ?? closes.at(-1);
  if (typeof price !== "number" || !Number.isFinite(price) || price === 0) {
    throw new YahooError(`No price returned for ${symbol}`, symbol);
  }

  // Prefer the daily series for the reference close: meta.previousClose can be
  // stale on futures/indices, and closes[-2] is unambiguously the prior bar.
  const prev =
    (closes.length >= 2 && closes[closes.length - 2]) ||
    meta.previousClose ||
    meta.chartPreviousClose ||
    price;

  const change = price - prev;
  return {
    symbol,
    price,
    previousClose: prev,
    change,
    changePercent: prev ? (change / prev) * 100 : 0,
    currency: meta.currency ?? (symbol.includes("/") ? symbol.split("/")[1] : "USD"),
    timestamp: meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    provider: "yahoo",
    status: isSymbolMarketOpen(symbol) ? "LIVE" : "MARKET_CLOSED",
  };
}

interface SparkResponse {
  spark?: {
    result?: { symbol?: string; response?: ChartResult[] }[] | null;
    error?: { code?: string; description?: string } | null;
  };
}

/**
 * One request, every symbol.
 *
 * Spark returns the same `meta` + `timestamp` + `close` payload the chart
 * endpoint does, for a whole symbol list at once. Both quotes and history go
 * through it, so a full portfolio refresh is two outbound requests rather than
 * two per holding — which is exactly what was tripping Yahoo's rate limiter.
 *
 * Returns a map keyed by the caller's OWN symbols (not Yahoo's), omitting
 * anything Yahoo could not resolve.
 */
async function spark(
  symbols: string[],
  range: string,
  interval: string,
): Promise<Map<string, { appSymbols: string[]; result: ChartResult }>> {
  // Several app symbols can map to the same Yahoo symbol; keep every claimant.
  const byYahoo = new Map<string, string[]>();
  for (const s of symbols) {
    const y = toYahooSymbol(s);
    byYahoo.set(y, [...(byYahoo.get(y) ?? []), s]);
  }

  const qs = new URLSearchParams({
    symbols: [...byYahoo.keys()].join(","),
    range,
    interval,
  });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SPARK_URL}?${qs}`, {
      signal: ctl.signal,
      cache: "no-store",
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) throw new YahooError(`HTTP ${res.status} from Yahoo spark`);
    const json = (await res.json()) as SparkResponse;
    const err = json.spark?.error;
    if (err) throw new YahooError(err.description ?? err.code ?? "Yahoo spark error");

    const out = new Map<string, { appSymbols: string[]; result: ChartResult }>();
    for (const entry of json.spark?.result ?? []) {
      const result = entry.response?.[0];
      const yahooSymbol = entry.symbol ?? result?.meta?.symbol;
      if (!result || !yahooSymbol) continue;
      const appSymbols = byYahoo.get(yahooSymbol);
      if (appSymbols) out.set(yahooSymbol, { appSymbols, result });
    }
    return out;
  } catch (err) {
    if (err instanceof YahooError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new YahooError(`Yahoo spark timed out after ${TIMEOUT_MS}ms`);
    }
    throw new YahooError(err instanceof Error ? err.message : "Unknown Yahoo error");
  } finally {
    clearTimeout(timer);
  }
}

/** Yahoo only accepts fixed range tokens, so round up to the nearest one. */
function rangeFor(outputsize: number): string {
  return outputsize > 1250 ? "10y" : outputsize > 500 ? "5y" : "2y";
}

function candlesFrom(r: ChartResult): Candle[] {
  const ts = r.timestamp ?? [];
  const q = r.indicators?.quote?.[0];
  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q?.close?.[i];
    if (typeof close !== "number" || !Number.isFinite(close)) continue;
    const open = q?.open?.[i];
    const high = q?.high?.[i];
    const low = q?.low?.[i];
    const volume = q?.volume?.[i];
    candles.push({
      date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      // Spark serves closes only; nothing in the app reads OHLC, so mirroring
      // the close keeps the Candle shape honest rather than inventing a range.
      open: typeof open === "number" ? open : close,
      high: typeof high === "number" ? high : close,
      low: typeof low === "number" ? low : close,
      close,
      volume: typeof volume === "number" ? volume : undefined,
    });
  }
  return candles;
}

export function createYahooProvider(): MarketDataProvider {
  return {
    name: "yahoo",

    async getQuote(symbol) {
      // 5 daily bars is the smallest window that still contains a prior close
      // across long weekends and market holidays.
      return quoteFrom(symbol, await chart(symbol, "5d", "1d"));
    },

    async getQuotes(symbols) {
      if (symbols.length === 0) return {};

      const out: Record<string, Quote> = {};
      let batchError: string | null = null;
      try {
        // 5 daily bars is the smallest window that still contains a prior
        // close across long weekends and market holidays.
        for (const { appSymbols, result } of (await spark(symbols, "5d", "1d")).values()) {
          for (const s of appSymbols) {
            try {
              out[s] = quoteFrom(s, result);
            } catch {
              // One unpriced symbol must not sink the batch; retried below.
            }
          }
        }
      } catch (e) {
        batchError = e instanceof Error ? e.message : "Yahoo batch failed";
      }

      // Spark silently omits symbols it cannot resolve; retry those one by one
      // via the chart endpoint, which covers a few tickers spark misses.
      const gaps = symbols.filter((s) => !out[s]);
      if (gaps.length) {
        const settled = await pooled(gaps, MAX_CONCURRENCY, (s) => this.getQuote(s));
        gaps.forEach((s, i) => {
          const r = settled[i];
          if (r?.status === "fulfilled") out[s] = r.value;
        });
      }

      if (Object.keys(out).length === 0) {
        throw new YahooError(batchError ?? "Yahoo returned no usable symbols");
      }
      return out;
    },

    async getHistoricalPrices(symbol, opts) {
      const outputsize = opts?.outputsize ?? 800;
      const r = await chart(
        symbol,
        rangeFor(outputsize),
        opts?.interval === "1week" ? "1wk" : "1d",
      );
      const candles = candlesFrom(r);
      if (candles.length === 0) throw new YahooError(`No history for ${symbol}`, symbol);
      return {
        symbol,
        candles: candles.slice(-outputsize),
        status: "MARKET_CLOSED",
      } satisfies HistorySeries;
    },

    async getHistories(symbols, opts) {
      if (symbols.length === 0) return {};
      const outputsize = opts?.outputsize ?? 800;
      const batch = await spark(
        symbols,
        rangeFor(outputsize),
        opts?.interval === "1week" ? "1wk" : "1d",
      );
      const out: Record<string, HistorySeries> = {};
      for (const { appSymbols, result } of batch.values()) {
        const candles = candlesFrom(result);
        if (candles.length === 0) continue;
        for (const s of appSymbols) {
          out[s] = { symbol: s, candles: candles.slice(-outputsize), status: "MARKET_CLOSED" };
        }
      }
      return out;
    },

    /**
     * Intraday bars for the 1D / 5D chart ranges. Daily candles collapse a
     * single session to one point, which is not a chart.
     */
    async getIntraday(symbol, range) {
      const r = await chart(symbol, range === "1D" ? "1d" : "5d", range === "1D" ? "5m" : "30m");
      const ts = r.timestamp ?? [];
      const q = r.indicators?.quote?.[0];
      const candles: Candle[] = [];
      for (let i = 0; i < ts.length; i++) {
        const close = q?.close?.[i];
        if (typeof close !== "number" || !Number.isFinite(close)) continue;
        candles.push({
          // Intraday points keep the full timestamp; the chart formats it.
          date: new Date(ts[i] * 1000).toISOString(),
          open: typeof q?.open?.[i] === "number" ? (q!.open![i] as number) : close,
          high: typeof q?.high?.[i] === "number" ? (q!.high![i] as number) : close,
          low: typeof q?.low?.[i] === "number" ? (q!.low![i] as number) : close,
          close,
          volume: typeof q?.volume?.[i] === "number" ? (q!.volume![i] as number) : undefined,
        });
      }
      if (candles.length === 0) throw new YahooError(`No intraday data for ${symbol}`, symbol);
      return { symbol, candles, status: "MARKET_CLOSED" } satisfies HistorySeries;
    },

    async getFxRate(pair) {
      const q = await this.getQuote(pair);
      return {
        pair,
        rate: q.price,
        changePercent: q.changePercent,
        status: q.status,
        timestamp: q.timestamp,
      } satisfies FxRate;
    },

    async getIndexQuote(symbol) {
      return this.getQuote(symbol);
    },
  };
}
