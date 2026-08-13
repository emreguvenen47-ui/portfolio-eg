import "server-only";
import type { Candle, FxRate, HistorySeries, MarketDataProvider, Quote } from "@/lib/types";

/**
 * Nasdaq chart adapter — daily candles with volume, no key.
 *
 * History is the one thing the rest of the stack cannot reliably get: Finnhub
 * and CNBC have no candle endpoint on the free tier, Twelve Data's 800
 * credits/day run out, and Yahoo throttles unauthenticated callers for hours
 * at a time. Without a fourth history source the price charts read
 * HISTORICAL DATA UNAVAILABLE most of the day.
 *
 * Quotes are deliberately not implemented here — the quote chain already has
 * four working sources, and adding a fifth would spend requests for nothing.
 */

const BASE = "https://api.nasdaq.com/api/quote";
const TIMEOUT_MS = 10_000;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

export class NasdaqError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NasdaqError";
  }
}

/**
 * Nasdaq needs the instrument's asset class in the query and rejects the
 * wrong one, so each candidate is tried in turn. ETFs dominate this app's
 * universe, hence the ordering.
 */
const ASSET_CLASSES = ["etf", "stocks", "index"] as const;

/** Symbols Nasdaq does not carry — FX pairs, futures and our synthetic keys. */
function supported(symbol: string): boolean {
  const s = symbol.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.]{0,9}$/.test(s) && !/^(US2Y|US10Y|VIX|DXY|SPX|NDX|XU100)$/.test(s);
}

interface NasdaqPoint {
  x?: number;
  y?: number;
  z?: {
    open?: string;
    high?: string;
    low?: string;
    close?: string;
    volume?: string;
    dateTime?: string;
  };
}

const num = (v: string | undefined): number => {
  if (!v) return 0;
  const n = Number(v.replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** "8/11/2025" -> "2025-08-11". */
function toIsoDate(v: string | undefined, fallbackMs: number | undefined): string {
  if (v) {
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return fallbackMs
    ? new Date(fallbackMs).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
}

async function fetchChart(symbol: string, days: number): Promise<Candle[]> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const dateRange = `fromdate=${from.toISOString().slice(0, 10)}&todate=${to
    .toISOString()
    .slice(0, 10)}`;

  let lastError = "Nasdaq returned no data";
  for (const assetclass of ASSET_CLASSES) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(
        `${BASE}/${encodeURIComponent(symbol)}/chart?assetclass=${assetclass}&${dateRange}`,
        {
          signal: ctl.signal,
          cache: "no-store",
          headers: { "User-Agent": UA, Accept: "application/json" },
        },
      );
      if (!res.ok) {
        lastError = `HTTP ${res.status} from Nasdaq`;
        continue;
      }
      const json = (await res.json()) as {
        data?: { chart?: NasdaqPoint[] | null } | null;
        status?: { rCode?: number };
      };
      const chart = json.data?.chart;
      if (!chart?.length) {
        lastError = `Nasdaq has no ${assetclass} chart for ${symbol}`;
        continue;
      }

      const candles: Candle[] = [];
      for (const p of chart) {
        const close = p.z?.close ? num(p.z.close) : (p.y ?? 0);
        if (!Number.isFinite(close) || close <= 0) continue;
        const volume = num(p.z?.volume);
        candles.push({
          date: toIsoDate(p.z?.dateTime, p.x),
          open: num(p.z?.open) || close,
          high: num(p.z?.high) || close,
          low: num(p.z?.low) || close,
          close,
          volume: volume > 0 ? volume : undefined,
        });
      }
      if (candles.length) return candles;
      lastError = `Nasdaq returned unparseable points for ${symbol}`;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        lastError = `Nasdaq timed out after ${TIMEOUT_MS}ms`;
      } else {
        lastError = err instanceof Error ? err.message : "Unknown Nasdaq error";
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new NasdaqError(lastError);
}

export function createNasdaqProvider(): MarketDataProvider {
  const notAQuoteSource = () => {
    throw new NasdaqError("Nasdaq adapter serves history only");
  };

  return {
    name: "nasdaq",

    async getQuote(): Promise<Quote> {
      return notAQuoteSource();
    },

    async getQuotes(): Promise<Record<string, Quote>> {
      return notAQuoteSource();
    },

    async getHistoricalPrices(symbol, opts) {
      if (!supported(symbol)) {
        throw new NasdaqError(`${symbol} is not covered by Nasdaq`);
      }
      const outputsize = opts?.outputsize ?? 800;
      // Trading days to calendar days, with headroom for weekends/holidays.
      const candles = await fetchChart(symbol, Math.ceil(outputsize * 1.5));
      return {
        symbol,
        candles: candles.slice(-outputsize),
        status: "MARKET_CLOSED",
      } satisfies HistorySeries;
    },

    async getFxRate(pair): Promise<FxRate> {
      throw new NasdaqError(`Nasdaq adapter serves no FX rate for ${pair}`);
    },

    async getIndexQuote(): Promise<Quote> {
      return notAQuoteSource();
    },
  };
}
