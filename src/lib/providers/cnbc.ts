import "server-only";
import type { FxRate, HistorySeries, MarketDataProvider, Quote } from "@/lib/types";
import { isSymbolMarketOpen } from "./market-hours";

/**
 * CNBC quote adapter — indices, yields, futures and FX.
 *
 * Fills the one real gap in the other three sources: Finnhub's free tier has
 * no indices, Twelve Data's free tier is 800 credits/day, and Yahoo throttles
 * unauthenticated callers hard. Without a fourth source, S&P 500, Nasdaq 100,
 * BIST 100, VIX, DXY, the Treasury yields and the commodity futures were all
 * UNAVAILABLE whenever the first three were exhausted — which, on a free
 * stack, is most of the time.
 *
 * No key, no quota, one batched request for the whole list, and it carries a
 * real venue timestamp per symbol. Quotes only: there is no history endpoint
 * here, so candles stay with the providers that have one.
 */

const BASE =
  "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol";
const TIMEOUT_MS = 8000;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

export class CnbcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CnbcError";
  }
}

/** App symbol -> CNBC symbol. Only what CNBC is actually good for. */
const SYMBOL_MAP: Record<string, string> = {
  SPX: ".SPX",
  NDX: ".NDX",
  XU100: ".XU100",
  VIX: ".VIX",
  DXY: ".DXY",
  US2Y: "US2Y",
  US10Y: "US10Y",
  "XAU/USD": "@GC.1",
  "XAG/USD": "@SI.1",
  "WTI/USD": "@CL.1",
  "BRENT/USD": "@LCO.1",
  "EUR/USD": "EUR=",
  "USD/TRY": "TRY=",
  "USD/JPY": "JPY=",
  "GBP/USD": "GBP=",
};

export function cnbcSupports(symbol: string): boolean {
  return symbol.trim().toUpperCase() in SYMBOL_MAP;
}

interface CnbcQuote {
  symbol?: string;
  code?: number;
  last?: string;
  previous_day_closing?: string;
  change_pct?: string;
  last_time?: string;
  currencyCode?: string;
}

/** CNBC formats numbers for humans: "7,753.11", "4.258%". */
function num(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[,%\s$]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * `last_time` is either a full ISO-ish stamp with offset, or a bare date on a
 * closed cash index. Both are venue time, which is what we want to display.
 */
function parseTime(v: string | undefined): string {
  if (!v) return new Date().toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export function createCnbcProvider(): MarketDataProvider {
  const fetchBatch = async (symbols: string[]): Promise<Record<string, Quote>> => {
    const supported = symbols.filter(cnbcSupports);
    if (supported.length === 0) {
      throw new CnbcError("No requested symbol is covered by CNBC");
    }

    // CNBC batches on a pipe separator; a comma-separated list is read as one
    // long symbol and comes back with code=1 and no data.
    const byCnbc = new Map<string, string>();
    for (const s of supported) byCnbc.set(SYMBOL_MAP[s.trim().toUpperCase()], s);

    const qs = new URLSearchParams({
      requestMethod: "itv",
      noform: "1",
      partnerId: "2",
      fund: "1",
      exthrs: "1",
      output: "json",
    });
    const url = `${BASE}?symbols=${[...byCnbc.keys()].map(encodeURIComponent).join("%7C")}&${qs}`;

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: ctl.signal,
        cache: "no-store",
        headers: { "User-Agent": UA, Accept: "application/json" },
      });
      if (!res.ok) throw new CnbcError(`HTTP ${res.status} from CNBC`);
      const json = (await res.json()) as {
        FormattedQuoteResult?: { FormattedQuote?: CnbcQuote | CnbcQuote[] };
      };
      const raw = json.FormattedQuoteResult?.FormattedQuote;
      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];

      const out: Record<string, Quote> = {};
      for (const q of list) {
        // code 0 is success; anything else means CNBC did not resolve it.
        if (q.code !== 0 || !q.symbol) continue;
        const appSymbol = byCnbc.get(q.symbol);
        if (!appSymbol) continue;

        const price = num(q.last);
        if (price === null || price === 0) continue;
        const prev = num(q.previous_day_closing) ?? price;
        const pct = num(q.change_pct);

        out[appSymbol] = {
          symbol: appSymbol,
          price,
          previousClose: prev,
          change: price - prev,
          changePercent: pct ?? (prev ? ((price - prev) / prev) * 100 : 0),
          currency: q.currencyCode ?? "USD",
          timestamp: parseTime(q.last_time),
          fetchedAt: new Date().toISOString(),
          provider: "cnbc",
          status: isSymbolMarketOpen(appSymbol) ? "LIVE" : "MARKET_CLOSED",
        };
      }

      if (Object.keys(out).length === 0) {
        throw new CnbcError("CNBC returned no usable symbols");
      }
      return out;
    } catch (err) {
      if (err instanceof CnbcError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new CnbcError(`CNBC timed out after ${TIMEOUT_MS}ms`);
      }
      throw new CnbcError(err instanceof Error ? err.message : "Unknown CNBC error");
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    name: "cnbc",
    supportsHistory: false,

    async getQuote(symbol) {
      const out = await fetchBatch([symbol]);
      const q = out[symbol];
      if (!q) throw new CnbcError(`No price returned for ${symbol}`);
      return q;
    },

    async getQuotes(symbols) {
      return fetchBatch(symbols);
    },

    async getHistoricalPrices(symbol): Promise<HistorySeries> {
      throw new CnbcError(`CNBC serves no history for ${symbol}`);
    },

    async getFxRate(pair): Promise<FxRate> {
      const q = await this.getQuote(pair);
      return {
        pair,
        rate: q.price,
        changePercent: q.changePercent,
        status: q.status,
        timestamp: q.timestamp,
      };
    },

    async getIndexQuote(symbol) {
      return this.getQuote(symbol);
    },
  };
}
