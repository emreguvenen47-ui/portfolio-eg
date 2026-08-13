import type { Candle } from "@/lib/types";
import type { Point } from "@/lib/portfolio/analytics";
import type { SavedPortfolio, SavedPosition } from "@/lib/server/ai-portfolios";

/**
 * Track record for a saved AI portfolio, from real prices only.
 *
 * Two rules shape the whole file:
 *
 *  1. Nothing before the creation date is computed. A modelled portfolio has
 *     no history it did not live through, and back-filling one would be the
 *     single most misleading thing this page could show.
 *
 *  2. An allocation change starts a new epoch. Units are recomputed at the
 *     boundary and held fixed within it, so editing today does not rewrite
 *     what last week's weights earned.
 *
 * A position with no usable price is excluded and reported, never estimated.
 */

export interface PositionPerformance {
  ticker: string;
  name: string;
  role: string;
  source: "ai" | "manual";
  /** Weight in the live allocation. */
  targetWeight: number;
  /** Weight implied by today's market value — drifts as prices move. */
  currentWeight: number;
  /** currentWeight − targetWeight, in weight points. */
  drift: number;
  value: number;
  /** Price return since this position entered the portfolio. */
  returnPct: number | null;
  /** Contribution to the portfolio's total return, in portfolio points. */
  contribution: number;
  dailyPct: number | null;
  startPrice: number | null;
  lastPrice: number | null;
  available: boolean;
}

export interface AiPortfolioPerformance {
  /** Daily index of portfolio value, starting at the creation amount. */
  series: Point[];
  value: number;
  startValue: number;
  totalReturnPct: number;
  totalReturnAbs: number;
  dailyChangePct: number;
  dailyChangeAbs: number;
  window: {
    m1: number | null;
    m3: number | null;
    ytd: number | null;
    sinceCreation: number | null;
  };
  positions: PositionPerformance[];
  best: PositionPerformance | null;
  worst: PositionPerformance | null;
  /** Tickers with no usable price, excluded from every figure above. */
  unavailable: string[];
  /** Share of the live allocation that could not be priced, 0..1. */
  unpricedWeight: number;
  currency: string;
}

/** Forward-filled close lookup for one symbol. */
class PriceSeries {
  private readonly dates: string[];
  private readonly closes: number[];

  constructor(candles: Candle[]) {
    const usable = candles.filter((c) => Number.isFinite(c.close) && c.close > 0);
    this.dates = usable.map((c) => c.date);
    this.closes = usable.map((c) => c.close);
  }

  get length(): number {
    return this.dates.length;
  }

  /** Last close on or before `date`; null when the series starts later. */
  at(date: string): number | null {
    if (this.dates.length === 0) return null;
    let lo = 0;
    let hi = this.dates.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.dates[mid] <= date) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found >= 0 ? this.closes[found] : null;
  }

  last(): number | null {
    return this.closes.length ? this.closes[this.closes.length - 1] : null;
  }
}

const day = (iso: string) => iso.slice(0, 10);

/** Every trading date at or after `from`, across all series we hold. */
function dateAxis(series: Map<string, PriceSeries>, from: string, candles: Record<string, Candle[]>): string[] {
  const dates = new Set<string>();
  for (const ticker of series.keys()) {
    for (const c of candles[ticker] ?? []) {
      if (c.date >= from) dates.add(c.date);
    }
  }
  return [...dates].sort();
}

function pctBetween(a: number | undefined, b: number | undefined): number | null {
  if (!a || !b || a <= 0) return null;
  return (b / a - 1) * 100;
}

export function computeAiPortfolioPerformance(
  portfolio: SavedPortfolio,
  candles: Record<string, Candle[]>,
  liveQuotes: Record<string, { price: number; changePercent: number } | undefined>,
): AiPortfolioPerformance {
  const startAmount = portfolio.baseline.amount || portfolio.built.amount || 0;
  const currency = portfolio.baseline.currency || portfolio.built.currency || "USD";
  const createdDay = day(portfolio.baseline.at || portfolio.createdAt);

  const epochs = [...portfolio.allocations].sort((a, b) => a.at.localeCompare(b.at));
  const live = epochs[epochs.length - 1];

  const tickers = [...new Set(epochs.flatMap((e) => e.positions.map((p) => p.ticker)))];
  const series = new Map<string, PriceSeries>();
  for (const t of tickers) series.set(t, new PriceSeries(candles[t] ?? []));

  /**
   * A ticker is usable only if we can price it BOTH at the day it entered and
   * today. Without a start price there is no baseline to measure from, and a
   * position measured from a guessed baseline would quietly distort the whole
   * portfolio's return.
   */
  const priceAt = (ticker: string, date: string): number | null => {
    const s = series.get(ticker);
    const fromCandles = s?.at(date) ?? null;
    if (fromCandles !== null) return fromCandles;
    // Fall back to the quote captured when the portfolio was saved.
    const base = portfolio.baseline.prices[ticker];
    return base && date >= day(portfolio.baseline.at) ? base.price : null;
  };

  const lastPriceOf = (ticker: string): number | null => {
    const q = liveQuotes[ticker];
    if (q && Number.isFinite(q.price) && q.price > 0) return q.price;
    return series.get(ticker)?.last() ?? portfolio.baseline.prices[ticker]?.price ?? null;
  };

  const unavailable = live.positions
    .filter((p) => priceAt(p.ticker, day(p.addedAt)) === null || lastPriceOf(p.ticker) === null)
    .map((p) => p.ticker);
  const unavailableSet = new Set(unavailable);

  const unpricedWeight = live.positions
    .filter((p) => unavailableSet.has(p.ticker))
    .reduce((s, p) => s + p.weight, 0);

  // ------------------------------------------------------------------ series
  const axis = dateAxis(series, createdDay, candles);
  const points: Point[] = [];

  if (axis.length > 0 && startAmount > 0) {
    let units = new Map<string, number>();
    let epochIndex = -1;
    let value = startAmount;

    for (const date of axis) {
      // Rebalance whenever we cross into a later epoch.
      let next = epochIndex;
      while (next + 1 < epochs.length && day(epochs[next + 1].at) <= date) next++;

      if (next !== epochIndex) {
        epochIndex = next;
        const positions = epochs[Math.max(0, epochIndex)].positions;
        // Renormalise across only the positions we can actually price, so an
        // unpriced sleeve does not silently shrink the portfolio's value.
        const priceable = positions.filter((p) => priceAt(p.ticker, date) !== null);
        const wSum = priceable.reduce((s, p) => s + p.weight, 0);
        units = new Map();
        if (wSum > 0) {
          for (const p of priceable) {
            const px = priceAt(p.ticker, date)!;
            units.set(p.ticker, (value * (p.weight / wSum)) / px);
          }
        }
      }

      let v = 0;
      for (const [ticker, u] of units) {
        const px = priceAt(ticker, date);
        if (px !== null) v += u * px;
      }
      if (v > 0) {
        value = v;
        points.push({ date, close: v });
      }
    }
  }

  // Append today's mark from live quotes so the series ends at the current
  // value rather than at yesterday's close.
  const liveUnits = (() => {
    const positions = live.positions.filter((p) => !unavailableSet.has(p.ticker));
    const wSum = positions.reduce((s, p) => s + p.weight, 0);
    const base = points.at(-1)?.close ?? startAmount;
    const m = new Map<string, number>();
    if (wSum > 0) {
      // Units implied by the live allocation at the last computed value.
      const epochStart = day(live.at);
      for (const p of positions) {
        const px = priceAt(p.ticker, epochStart) ?? lastPriceOf(p.ticker);
        if (px) m.set(p.ticker, (base * (p.weight / wSum)) / px);
      }
    }
    return m;
  })();

  const positionValues = new Map<string, number>();
  let liveValue = 0;
  for (const p of live.positions) {
    if (unavailableSet.has(p.ticker)) {
      positionValues.set(p.ticker, 0);
      continue;
    }
    const px = lastPriceOf(p.ticker);
    const u = liveUnits.get(p.ticker);
    const v = px && u ? px * u : 0;
    positionValues.set(p.ticker, v);
    liveValue += v;
  }
  if (liveValue <= 0) liveValue = points.at(-1)?.close ?? startAmount;

  const today = new Date().toISOString().slice(0, 10);
  if (points.length && points.at(-1)!.date !== today) {
    points.push({ date: today, close: liveValue });
  } else if (points.length) {
    points[points.length - 1] = { date: today, close: liveValue };
  }

  // ----------------------------------------------------------------- windows
  const findAtOrAfter = (from: string) => points.find((p) => p.date >= from);
  const lastPoint = points.at(-1);
  const firstPoint = points[0];

  const shift = (days: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };

  const window = {
    m1: pctBetween(findAtOrAfter(shift(30))?.close, lastPoint?.close),
    m3: pctBetween(findAtOrAfter(shift(90))?.close, lastPoint?.close),
    ytd: pctBetween(
      findAtOrAfter(`${new Date().getUTCFullYear()}-01-01`)?.close,
      lastPoint?.close,
    ),
    sinceCreation: pctBetween(firstPoint?.close ?? startAmount, lastPoint?.close),
  };

  const prevPoint = points.length >= 2 ? points[points.length - 2] : null;
  const dailyChangePct =
    prevPoint && prevPoint.close > 0 ? (liveValue / prevPoint.close - 1) * 100 : 0;

  // --------------------------------------------------------------- positions
  const totalReturnPct = window.sinceCreation ?? 0;

  const positions: PositionPerformance[] = live.positions.map((p) => {
    const available = !unavailableSet.has(p.ticker);
    const entryDay = day(p.addedAt);
    const startPrice = available ? priceAt(p.ticker, entryDay) : null;
    const lastPrice = available ? lastPriceOf(p.ticker) : null;
    const returnPct =
      startPrice && lastPrice ? (lastPrice / startPrice - 1) * 100 : null;
    const value = positionValues.get(p.ticker) ?? 0;

    return {
      ticker: p.ticker,
      name: p.name,
      role: p.role,
      source: p.source,
      targetWeight: p.weight,
      currentWeight: liveValue > 0 ? value / liveValue : 0,
      drift: (liveValue > 0 ? value / liveValue : 0) - p.weight,
      value,
      returnPct,
      // Weight at entry times the position's own return — the standard
      // decomposition, and it sums to roughly the portfolio return.
      contribution: returnPct === null ? 0 : p.weight * returnPct,
      dailyPct: liveQuotes[p.ticker]?.changePercent ?? null,
      startPrice,
      lastPrice,
      available,
    };
  });

  const ranked = positions
    .filter((p) => p.available && p.returnPct !== null)
    .sort((a, b) => (b.returnPct ?? 0) - (a.returnPct ?? 0));

  return {
    series: points,
    value: liveValue,
    startValue: startAmount,
    totalReturnPct,
    totalReturnAbs: liveValue - startAmount,
    dailyChangePct,
    dailyChangeAbs: liveValue * (dailyChangePct / 100),
    window,
    positions,
    best: ranked[0] ?? null,
    worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    unavailable,
    unpricedWeight,
    currency,
  };
}

/** Rescale weights so they sum to exactly 1, using largest-remainder rounding. */
export function normaliseTo100(positions: SavedPosition[]): SavedPosition[] {
  const total = positions.reduce((s, p) => s + (Number.isFinite(p.weight) ? p.weight : 0), 0);
  if (total <= 0) return positions;

  const raw = positions.map((p) => (p.weight / total) * 10_000);
  const floored = raw.map((r) => Math.floor(r));
  let deficit = 10_000 - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (deficit <= 0) break;
    floored[i] += 1;
    deficit -= 1;
  }
  return positions.map((p, i) => ({ ...p, weight: floored[i] / 10_000 }));
}
