import type { Candle, Quote } from "@/lib/types";
import type { KeyMetrics } from "@/lib/providers/fundamentals";
import { scoreQuality } from "./quality-score";

/**
 * Opportunity scanner.
 *
 * Deterministic ranking over data the app already has. Components with no data
 * are dropped from the average rather than scored zero, and each candidate
 * reports which components actually contributed — a symbol ranked on two
 * signals should not read the same as one ranked on seven.
 *
 * The labels describe where a name sits on these measures today. They are not
 * buy recommendations and the UI says so.
 */

export type Verdict = "ATTRACTIVE" | "NEUTRAL" | "EXTENDED";

export interface ScanComponent {
  key: string;
  label: string;
  score: number;
  detail: string;
}

export interface ScanRow {
  symbol: string;
  price: number | null;
  verdict: Verdict;
  score: number | null;
  /** How many of the eight components had data. */
  coverage: number;
  components: ScanComponent[];
  /** Buckets the UI filters on. */
  tags: string[];
}

const clamp = (v: number, good: number, bad: number) =>
  Math.round(Math.max(0, Math.min(1, (v - bad) / (good - bad))) * 100);

const sma = (closes: number[], n: number): number | null =>
  closes.length < n ? null : closes.slice(-n).reduce((a, b) => a + b, 0) / n;

function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + gain / period / avgLoss);
}

function annualVol(closes: number[], period = 60): number | null {
  if (closes.length < period + 1) return null;
  const rets: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push(closes[i] / closes[i - 1] - 1);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  return Math.sqrt(varr * 252) * 100;
}

export function scanSymbol(
  symbol: string,
  candles: Candle[],
  quote: Quote | undefined,
  metrics: KeyMetrics | null,
  tags: string[],
): ScanRow {
  const closes = candles.map((c) => c.close).filter((c) => Number.isFinite(c) && c > 0);
  const last = quote?.price ?? closes.at(-1) ?? null;
  const components: ScanComponent[] = [];

  const add = (key: string, label: string, score: number | null, detail: string) => {
    if (score !== null) components.push({ key, label, score, detail });
  };

  if (last !== null && closes.length > 60) {
    // Distance from the 52-week high. Nearer the high scores lower here —
    // this axis is looking for names that have pulled back, not for momentum,
    // which the separate momentum component covers.
    const window = closes.slice(-253);
    const high = Math.max(...window);
    const fromHigh = (last / high - 1) * 100;
    add(
      "fromHigh",
      "Discount to 52w high",
      // −25% scores full marks, at the high scores zero; below −45% is more
      // often damage than opportunity, so the scale bottoms out there.
      fromHigh < -45 ? 40 : clamp(-fromHigh, 25, 0),
      `${fromHigh.toFixed(1)}% from high`,
    );

    const ma50 = sma(closes, 50);
    const ma200 = sma(closes, 200);
    if (ma50 !== null && ma200 !== null) {
      const trend = ma50 > ma200 ? 1 : 0;
      const vs200 = (last / ma200 - 1) * 100;
      add(
        "trend",
        "50/200DMA trend",
        // Reward an uptrend, but penalise being stretched far above the 200DMA.
        trend === 1 ? clamp(20 - Math.abs(vs200 - 8), 20, -10) : 30,
        `${ma50 > ma200 ? "Golden" : "Death"} cross regime, ${vs200.toFixed(1)}% vs 200DMA`,
      );
    }

    const r = rsi(closes);
    if (r !== null) {
      // Mid-range RSI scores best; overbought and oversold both score down.
      add("rsi", "RSI(14)", clamp(-Math.abs(r - 45), 0, -35), r.toFixed(1));
    }

    if (closes.length > 128) {
      const mom = (last / closes[closes.length - 128] - 1) * 100;
      add("momentum", "6M momentum", clamp(mom, 25, -20), `${mom.toFixed(1)}%`);
    }

    const vol = annualVol(closes);
    if (vol !== null) {
      add("volatility", "Realised volatility", clamp(-vol, -15, -45), `${vol.toFixed(1)}% annual`);
    }
  }

  const quality = scoreQuality(metrics);
  if (quality.total !== null) {
    add("quality", "Financial quality", quality.total, `${quality.total}/100`);
  }

  const pe = metrics?.peTTM as number | undefined;
  if (pe !== undefined && Number.isFinite(pe) && pe > 0) {
    add("valuation", "P/E (TTM)", clamp(-pe, -12, -40), pe.toFixed(1));
  }

  // Analyst consensus is optional by design — the spec allows scanning without
  // it, so its absence just lowers coverage rather than blocking the row.
  const rec = metrics?.__recScore as number | undefined;
  if (rec !== undefined) {
    add("analyst", "Analyst consensus", rec, "buy/hold/sell mix");
  }

  const score = components.length
    ? Math.round(components.reduce((s, c) => s + c.score, 0) / components.length)
    : null;

  return {
    symbol,
    price: last,
    score,
    coverage: components.length,
    components,
    tags,
    verdict:
      score === null ? "NEUTRAL" : score >= 62 ? "ATTRACTIVE" : score <= 42 ? "EXTENDED" : "NEUTRAL",
  };
}

/** The universe the scanner sweeps, with the filter buckets each belongs to. */
export const SCAN_UNIVERSE: { symbol: string; tags: string[] }[] = [
  { symbol: "SPY", tags: ["ETFs", "S&P 500"] },
  { symbol: "QQQ", tags: ["ETFs", "Technology"] },
  { symbol: "RSP", tags: ["ETFs", "S&P 500", "Watchlist"] },
  { symbol: "SMH", tags: ["ETFs", "Technology", "Watchlist"] },
  { symbol: "XLK", tags: ["ETFs", "Technology"] },
  { symbol: "XLI", tags: ["ETFs", "Industrials", "Watchlist"] },
  { symbol: "XLF", tags: ["ETFs"] },
  { symbol: "XLE", tags: ["ETFs", "Commodities"] },
  { symbol: "VGK", tags: ["ETFs", "International", "Watchlist"] },
  { symbol: "EMXC", tags: ["ETFs", "International", "Watchlist"] },
  { symbol: "KWEB", tags: ["ETFs", "International", "Watchlist"] },
  { symbol: "INDA", tags: ["ETFs", "International"] },
  { symbol: "GLDM", tags: ["ETFs", "Commodities", "Watchlist"] },
  { symbol: "CPER", tags: ["ETFs", "Commodities", "Watchlist"] },
  { symbol: "SGOV", tags: ["ETFs", "Watchlist"] },
  { symbol: "AAPL", tags: ["Stocks", "S&P 500", "Technology"] },
  { symbol: "MSFT", tags: ["Stocks", "S&P 500", "Technology"] },
  { symbol: "NVDA", tags: ["Stocks", "S&P 500", "Technology"] },
  { symbol: "GOOGL", tags: ["Stocks", "S&P 500", "Technology"] },
  { symbol: "AMZN", tags: ["Stocks", "S&P 500"] },
  { symbol: "META", tags: ["Stocks", "S&P 500", "Technology"] },
  { symbol: "AVGO", tags: ["Stocks", "S&P 500", "Technology"] },
  { symbol: "CAT", tags: ["Stocks", "S&P 500", "Industrials"] },
  { symbol: "GE", tags: ["Stocks", "S&P 500", "Industrials"] },
  { symbol: "JPM", tags: ["Stocks", "S&P 500"] },
  { symbol: "UNH", tags: ["Stocks", "S&P 500"] },
];

export const SCAN_FILTERS = [
  "All",
  "Stocks",
  "ETFs",
  "S&P 500",
  "Technology",
  "Industrials",
  "International",
  "Commodities",
  "Watchlist",
] as const;
