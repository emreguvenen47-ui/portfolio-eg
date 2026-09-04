import "server-only";
import type { FxRate, HistorySeries, MarketDataProvider, Quote } from "@/lib/types";
import { isSymbolMarketOpen } from "./market-hours";
import { isBistSymbol } from "./bist";

/**
 * EODHD — the primary market-data provider.
 *
 * Paid "All World" plan: 100k requests/day, bulk real-time quotes, EOD and
 * intraday history, FOREX pairs and world indices. Effectively unmetered at
 * this app's request volume, so it sits FIRST in the provider chain and the
 * free-tier sources become fallbacks.
 *
 * Known hole, verified against the live /exchanges-list endpoint: EODHD does
 * not carry Borsa İstanbul at any plan tier (no IS exchange). BIST symbols are
 * therefore declined here so the chain falls through to the provider that does
 * price them. Never silently substitute.
 *
 * Schemas verified against real responses on 2026-09-01 (see the shapes in the
 * mappers below) — not guessed.
 */

const BASE = "https://eodhd.com/api";

/** Server-side only. Never ships to the client, never printed. */
function apiKey(): string {
  const k = process.env.EODHD_API_KEY?.trim();
  if (!k) throw new Error("EODHD_API_KEY is not configured");
  return k;
}

export function eodhdKeyPresent(): boolean {
  return Boolean(process.env.EODHD_API_KEY?.trim());
}

/** Well-known index symbols (app convention: caret prefix) → EODHD .INDX codes. */
const INDEX_MAP: Record<string, string> = {
  "^GSPC": "GSPC.INDX",
  "^SPX": "GSPC.INDX",
  "^NDX": "NDX.INDX",
  "^IXIC": "IXIC.INDX",
  "^DJI": "DJI.INDX",
  "^RUT": "RUT.INDX",
  "^VIX": "VIX.INDX",
  "^TNX": "TNX.INDX",
  "^XU100": "XU100.INDX",
};

/** Currency by venue of the mapped EODHD code. */
function currencyFor(eodhdCode: string): string {
  if (eodhdCode.endsWith(".FOREX")) return "USD";
  return "USD"; // .US equities and .INDX values used by this app are USD-quoted
}

/**
 * App symbol → EODHD code, or null when EODHD cannot serve it (BIST, unknown
 * index aliases, FX pairs go through getFxRate instead).
 */
export function toEodhdCode(symbol: string): string | null {
  const s = symbol.trim().toUpperCase();
  if (!s) return null;
  if (isBistSymbol(s)) return null; // verified: no Borsa İstanbul on EODHD
  if (s.includes("/")) return null; // FX pairs are handled by getFxRate
  if (s.startsWith("^")) return INDEX_MAP[s] ?? null;
  // Plain US listings, including class shares like BRK.B → BRK-B.US
  if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(s)) return `${s.replace(/\./g, "-")}.US`;
  return null;
}

interface RealTimeRow {
  code: string;
  timestamp: number | string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string;
  previousClose: number | string;
  change: number | string;
  change_p: number | string;
}

interface EodRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjusted_close: number;
  volume: number;
}

interface IntradayRow {
  timestamp: number;
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : NaN;
};

async function eodhdFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({ ...params, api_token: apiKey(), fmt: "json" });
  const res = await fetch(`${BASE}${path}?${qs}`, {
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (res.status === 429) throw new Error("EODHD rate limit (429)");
  if (res.status === 402 || res.status === 403) {
    throw new Error(`EODHD subscription does not permit this endpoint (${res.status})`);
  }
  if (res.status === 404) throw new Error("EODHD: ticker not found");
  if (!res.ok) throw new Error(`EODHD HTTP ${res.status}`);
  return (await res.json()) as T;
}

function rowToQuote(appSymbol: string, row: RealTimeRow): Quote | null {
  const price = num(row.close);
  const prev = num(row.previousClose);
  // A halted/unknown ticker comes back with "NA" strings; a real quote never
  // has a non-finite price. Skip rather than fabricate.
  if (!Number.isFinite(price) || price <= 0) return null;
  const ts = num(row.timestamp);
  return {
    symbol: appSymbol,
    price,
    previousClose: Number.isFinite(prev) ? prev : price,
    change: Number.isFinite(num(row.change)) ? num(row.change) : price - prev,
    changePercent: Number.isFinite(num(row.change_p)) ? num(row.change_p) : 0,
    currency: currencyFor(row.code ?? ""),
    timestamp: new Date((Number.isFinite(ts) ? ts : Date.now() / 1000) * 1000).toISOString(),
    fetchedAt: new Date().toISOString(),
    provider: "eodhd",
    status: isSymbolMarketOpen(appSymbol) ? "LIVE" : "MARKET_CLOSED",
  };
}

function eodRowsToSeries(symbol: string, rows: EodRow[], outputsize: number): HistorySeries {
  const candles = rows
    .filter((r) => Number.isFinite(r.close))
    .map((r) => ({
      date: r.date,
      open: r.open,
      high: r.high,
      low: r.low,
      // Adjusted close keeps long-window returns split/dividend-correct, which
      // is what every downstream return/vol calculation assumes.
      close: r.adjusted_close ?? r.close,
      volume: r.volume,
    }))
    .slice(-outputsize);
  return { symbol, candles, status: isSymbolMarketOpen(symbol) ? "LIVE" : "MARKET_CLOSED" };
}

export function createEodhdProvider(): MarketDataProvider {
  return {
    name: "eodhd",
    supportsHistory: true,

    async getQuote(symbol: string): Promise<Quote> {
      const quotes = await this.getQuotes([symbol]);
      const q = quotes[symbol];
      if (!q) throw new Error(`EODHD cannot price ${symbol}`);
      return q;
    },

    async getQuotes(symbols: string[]): Promise<Record<string, Quote>> {
      const mapped = symbols
        .map((s) => ({ app: s, code: toEodhdCode(s) }))
        .filter((m): m is { app: string; code: string } => Boolean(m.code));
      if (mapped.length === 0) throw new Error("EODHD serves none of the requested symbols");

      const [first, ...rest] = mapped;
      const params: Record<string, string> = {};
      if (rest.length > 0) params.s = rest.map((m) => m.code).join(",");
      const raw = await eodhdFetch<RealTimeRow | RealTimeRow[]>(
        `/real-time/${encodeURIComponent(first!.code)}`,
        params,
      );
      const rows = Array.isArray(raw) ? raw : [raw];

      const byCode = new Map(rows.map((r) => [r.code, r]));
      const out: Record<string, Quote> = {};
      for (const m of mapped) {
        const row = byCode.get(m.code);
        if (!row) continue;
        const q = rowToQuote(m.app, row);
        if (q) out[m.app] = q;
      }
      return out;
    },

    async getHistoricalPrices(symbol, opts): Promise<HistorySeries> {
      const code = toEodhdCode(symbol);
      if (!code) throw new Error(`EODHD cannot serve ${symbol}`);
      const outputsize = opts?.outputsize ?? 800;
      // Trading days → calendar days with holiday slack.
      const from = new Date(Date.now() - outputsize * 1.6 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const rows = await eodhdFetch<EodRow[]>(`/eod/${encodeURIComponent(code)}`, {
        period: "d",
        from,
        order: "a",
      });
      const series = eodRowsToSeries(symbol, rows, outputsize);
      if (series.candles.length === 0) throw new Error("EODHD returned no candles");
      return series;
    },

    // One request per symbol, sequential like the rest of the app's bulk paths
    // — but with 100k/day of headroom this is capacity, not a constraint.
    async getHistories(symbols, opts): Promise<Record<string, HistorySeries>> {
      const out: Record<string, HistorySeries> = {};
      for (const s of symbols) {
        if (!toEodhdCode(s)) continue;
        try {
          out[s] = await this.getHistoricalPrices(s, opts);
        } catch {
          // Skip; the orchestrator falls back per symbol.
        }
      }
      return out;
    },

    async getIntraday(symbol, range): Promise<HistorySeries> {
      const code = toEodhdCode(symbol);
      if (!code) throw new Error(`EODHD cannot serve ${symbol}`);
      const interval = range === "1D" ? "5m" : "1h";
      const days = range === "1D" ? 2 : 7;
      const from = Math.floor(Date.now() / 1000) - days * 86_400;
      const rows = await eodhdFetch<IntradayRow[]>(`/intraday/${encodeURIComponent(code)}`, {
        interval,
        from: String(from),
      });
      const candles = rows
        .filter((r) => Number.isFinite(r.close))
        .map((r) => ({
          date: new Date(r.timestamp * 1000).toISOString(),
          open: r.open,
          high: r.high,
          low: r.low,
          close: r.close,
          volume: r.volume,
        }));
      if (candles.length < 2) throw new Error("EODHD returned too few intraday bars");
      return {
        symbol,
        candles,
        status: isSymbolMarketOpen(symbol) ? "LIVE" : "MARKET_CLOSED",
      };
    },

    async getFxRate(pair: string): Promise<FxRate> {
      // "USD/TRY" → USDTRY.FOREX (verified live: close/previousClose/change_p).
      const m = /^([A-Z]{3})\/([A-Z]{3})$/.exec(pair.trim().toUpperCase());
      if (!m) throw new Error(`EODHD cannot parse FX pair ${pair}`);
      const code = `${m[1]}${m[2]}.FOREX`;
      const row = await eodhdFetch<RealTimeRow>(`/real-time/${code}`, {});
      const rate = num(row.close);
      if (!Number.isFinite(rate) || rate <= 0) throw new Error(`EODHD has no rate for ${pair}`);
      return {
        pair,
        rate,
        changePercent: Number.isFinite(num(row.change_p)) ? num(row.change_p) : 0,
        status: "LIVE",
        timestamp: new Date(num(row.timestamp) * 1000).toISOString(),
      };
    },

    async getIndexQuote(symbol: string): Promise<Quote> {
      return this.getQuote(symbol);
    },
  };
}
