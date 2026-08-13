import "server-only";
import type { FxRate, HistorySeries, MarketDataProvider, Quote } from "@/lib/types";

/**
 * open.er-api.com — FX only, no key, no quota.
 *
 * This is the floor under the currency pages. Every other FX source here is
 * either rate limited (Yahoo), credit metered (Twelve Data) or absent from the
 * free tier (Finnhub), and when all three are unavailable the alternative was
 * showing a GENERATED exchange rate. A real rate from yesterday's fixing beats
 * an invented one from this morning.
 *
 * It publishes one fixing per day, so it reports DELAYED and carries no
 * intraday change. It never claims to be live.
 */

const URL = "https://open.er-api.com/v6/latest/USD";
const TIMEOUT_MS = 8000;

interface ErApiResponse {
  result?: string;
  time_last_update_utc?: string;
  time_last_update_unix?: number;
  rates?: Record<string, number>;
}

let cached: { rates: Record<string, number>; at: string; expires: number } | null = null;

async function load(): Promise<{ rates: Record<string, number>; at: string }> {
  if (cached && Date.now() < cached.expires) return cached;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(URL, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} from open.er-api`);
    const json = (await res.json()) as ErApiResponse;
    if (json.result !== "success" || !json.rates) {
      throw new Error("open.er-api returned no rates");
    }
    const at = json.time_last_update_unix
      ? new Date(json.time_last_update_unix * 1000).toISOString()
      : new Date().toISOString();
    // The upstream fixing changes once a day; an hour of caching is generous.
    cached = { rates: json.rates, at, expires: Date.now() + 60 * 60_000 };
    return cached;
  } finally {
    clearTimeout(timer);
  }
}

/** "EUR/USD" -> rate, derived from the USD-based table. */
function rateFor(rates: Record<string, number>, pair: string): number | null {
  const m = pair.trim().toUpperCase().match(/^([A-Z]{3})\/([A-Z]{3})$/);
  if (!m) return null;
  const [, base, quote] = m;
  const perUsd = (c: string) => (c === "USD" ? 1 : rates[c]);
  const b = perUsd(base);
  const q = perUsd(quote);
  if (!b || !q) return null;
  return q / b;
}

const NOTE = "Daily fixing from open.er-api — real rate, no intraday change";

export function createErApiProvider(): MarketDataProvider {
  return {
    name: "erapi",
    supportsHistory: false,

    async getQuote(symbol) {
      const { rates, at } = await load();
      const rate = rateFor(rates, symbol);
      if (rate === null) throw new Error(`${symbol} is not an FX pair this source covers`);
      return {
        symbol,
        price: rate,
        previousClose: rate,
        change: 0,
        changePercent: 0,
        currency: symbol.split("/")[1] ?? "USD",
        timestamp: at,
        fetchedAt: new Date().toISOString(),
        provider: "erapi",
        status: "MARKET_CLOSED",
        fallbackReason: NOTE,
      } satisfies Quote;
    },

    async getQuotes(symbols) {
      const { rates, at } = await load();
      const out: Record<string, Quote> = {};
      for (const s of symbols) {
        const rate = rateFor(rates, s);
        if (rate === null) continue;
        out[s] = {
          symbol: s,
          price: rate,
          previousClose: rate,
          change: 0,
          changePercent: 0,
          currency: s.split("/")[1] ?? "USD",
          timestamp: at,
          fetchedAt: new Date().toISOString(),
          provider: "erapi",
          status: "MARKET_CLOSED",
          fallbackReason: NOTE,
        };
      }
      if (Object.keys(out).length === 0) {
        throw new Error("No requested symbol is an FX pair");
      }
      return out;
    },

    async getHistoricalPrices(symbol): Promise<HistorySeries> {
      throw new Error(`open.er-api serves no history for ${symbol}`);
    },

    async getFxRate(pair): Promise<FxRate> {
      const { rates, at } = await load();
      const rate = rateFor(rates, pair);
      if (rate === null) throw new Error(`${pair} not covered`);
      return { pair, rate, changePercent: 0, status: "MARKET_CLOSED", timestamp: at };
    },

    async getIndexQuote(symbol) {
      return this.getQuote(symbol);
    },
  };
}
