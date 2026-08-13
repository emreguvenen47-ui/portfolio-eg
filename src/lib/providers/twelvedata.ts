import "server-only";
import type { Candle, FxRate, HistorySeries, MarketDataProvider, Quote } from "@/lib/types";
import { isSymbolMarketOpen } from "./market-hours";

/**
 * Twelve Data adapter.
 *
 * The API key is read from a NON-`NEXT_PUBLIC_` env var and this module is
 * marked `server-only`, so importing it from a client component is a build
 * error rather than a silent key leak.
 */

const BASE = "https://api.twelvedata.com";
const TIMEOUT_MS = 8000;

/**
 * The basic plan allows 8 credits per minute, and a batch quote costs one
 * credit per symbol — so an 11-symbol index/FX sweep 429s on arrival unless it
 * is split and paced. Requests draw from a trailing-minute bucket and callers
 * get partial results when it runs dry, which the orchestrator fills from
 * cache rather than from generated data.
 */
const CREDITS_PER_MINUTE = Number(process.env.TWELVEDATA_CREDITS_PER_MINUTE ?? 7);

/** Timestamps of credits spent in the trailing 60s. */
let recentCredits: number[] = [];

function creditsAvailable(): number {
  const cutoff = Date.now() - 60_000;
  recentCredits = recentCredits.filter((t) => t > cutoff);
  return Math.max(0, CREDITS_PER_MINUTE - recentCredits.length);
}

function takeCredits(n: number): boolean {
  if (creditsAvailable() < n) return false;
  const now = Date.now();
  for (let i = 0; i < n; i++) recentCredits.push(now);
  return true;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly symbol?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

async function call<T>(
  path: string,
  params: Record<string, string>,
  apiKey: string,
  credits = 1,
): Promise<T> {
  if (!takeCredits(credits)) {
    // Our own ceiling, not the provider's. Worded so the orchestrator does not
    // read it as a 429 and park Twelve Data for minutes at a time.
    throw new ProviderError("Local per-minute credit budget is spent");
  }
  const qs = new URLSearchParams({ ...params, apikey: apiKey });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}?${qs}`, {
      signal: ctl.signal,
      // Prices are cached by our own layer; don't let Next cache them too.
      cache: "no-store",
    });
    if (!res.ok) throw new ProviderError(`HTTP ${res.status} from Twelve Data`);
    const json = (await res.json()) as unknown;

    // Twelve Data signals failure in the body with status:"error", HTTP 200.
    if (json && typeof json === "object" && "status" in json) {
      const s = json as { status?: string; message?: string; code?: number };
      if (s.status === "error") {
        throw new ProviderError(s.message ?? `Twelve Data error ${s.code ?? ""}`.trim());
      }
    }
    return json as T;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new ProviderError(`Twelve Data timed out after ${TIMEOUT_MS}ms`);
    }
    throw new ProviderError(err instanceof Error ? err.message : "Unknown provider error");
  } finally {
    clearTimeout(timer);
  }
}

interface TdQuote {
  symbol?: string;
  close?: string;
  previous_close?: string;
  change?: string;
  percent_change?: string;
  currency?: string;
  datetime?: string;
  is_market_open?: boolean;
  status?: string;
  message?: string;
}

const num = (v: string | undefined, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function mapQuote(symbol: string, q: TdQuote): Quote {
  const price = num(q.close);
  if (!price) throw new ProviderError(`No price returned for ${symbol}`, symbol);
  const prev = num(q.previous_close, price);
  return {
    symbol,
    price,
    previousClose: prev,
    change: num(q.change, price - prev),
    changePercent: num(q.percent_change, prev ? ((price - prev) / prev) * 100 : 0),
    currency: q.currency ?? "USD",
    timestamp: q.datetime ?? new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    provider: "twelvedata",
    // Twelve Data reports venue state directly; fall back to our own calendar
    // when the field is absent.
    status:
      (q.is_market_open ?? isSymbolMarketOpen(symbol)) ? "LIVE" : "MARKET_CLOSED",
  };
}

/** The configured key, for the reference and fundamentals endpoints. */
export const twelveDataKey = (): string | null =>
  process.env.TWELVE_DATA_API_KEY?.trim() || null;

export function createTwelveDataProvider(apiKey: string): MarketDataProvider {
  return {
    name: "twelvedata",

    async getQuote(symbol) {
      const raw = await call<TdQuote>("/quote", { symbol }, apiKey);
      return mapQuote(symbol, raw);
    },

    async getQuotes(symbols) {
      if (symbols.length === 0) return {};
      if (symbols.length === 1) {
        const only = symbols[0];
        return { [only]: await this.getQuote(only) };
      }

      const out: Record<string, Quote> = {};
      let lastError: unknown = null;

      // Split into per-minute-affordable chunks. Sending all 11 index/FX
      // symbols as one batch costs 11 credits against an 8/minute ceiling and
      // is refused outright, taking the whole sweep down with it.
      for (let i = 0; i < symbols.length; i += CREDITS_PER_MINUTE) {
        const chunk = symbols.slice(i, i + CREDITS_PER_MINUTE);
        try {
          const raw = await call<Record<string, TdQuote> | TdQuote>(
            "/quote",
            { symbol: chunk.join(",") },
            apiKey,
            chunk.length,
          );
          for (const s of chunk) {
            const entry =
              chunk.length === 1
                ? (raw as TdQuote)
                : (raw as Record<string, TdQuote>)[s];
            if (!entry) continue;
            try {
              out[s] = mapQuote(s, entry);
            } catch {
              // One bad symbol must not sink the whole batch.
            }
          }
        } catch (e) {
          // Out of per-minute credits, or the chunk failed. Keep whatever the
          // earlier chunks returned; the caller serves cache for the rest.
          lastError = e;
          break;
        }
      }

      if (Object.keys(out).length === 0) {
        throw lastError instanceof Error
          ? lastError
          : new ProviderError("Batch quote returned no usable symbols");
      }
      return out;
    },

    async getHistoricalPrices(symbol, opts) {
      const raw = await call<{ values?: Record<string, string>[] }>(
        "/time_series",
        {
          symbol,
          interval: opts?.interval ?? "1day",
          outputsize: String(opts?.outputsize ?? 800),
          order: "ASC",
        },
        apiKey,
      );
      const values = raw.values ?? [];
      if (values.length === 0) throw new ProviderError(`No history for ${symbol}`, symbol);
      const candles: Candle[] = values.map((v) => ({
        date: (v.datetime ?? "").slice(0, 10),
        open: num(v.open),
        high: num(v.high),
        low: num(v.low),
        close: num(v.close),
        volume: v.volume ? num(v.volume) : undefined,
      }));
      return { symbol, candles, status: "MARKET_CLOSED" } satisfies HistorySeries;
    },

    async getFxRate(pair) {
      const raw = await call<{ rate?: number; timestamp?: number }>(
        "/exchange_rate",
        { symbol: pair },
        apiKey,
      );
      if (typeof raw.rate !== "number") throw new ProviderError(`No FX rate for ${pair}`, pair);
      let changePercent = 0;
      try {
        const q = await this.getQuote(pair);
        changePercent = q.changePercent;
      } catch {
        // exchange_rate has no change field; leave it at 0 rather than invent one.
      }
      return {
        pair,
        rate: raw.rate,
        changePercent,
        status: "MARKET_CLOSED",
        timestamp: raw.timestamp
          ? new Date(raw.timestamp * 1000).toISOString()
          : new Date().toISOString(),
      } satisfies FxRate;
    },

    async getIndexQuote(symbol) {
      return this.getQuote(symbol);
    },
  };
}
