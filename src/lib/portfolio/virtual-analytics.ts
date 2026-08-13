import type { Candle, Quote } from "@/lib/types";
import type { Point } from "./analytics";
import type { Trade, VirtualPortfolio } from "@/lib/server/virtual-portfolios";

/**
 * Valuation and P&L for a paper portfolio, from real prices only.
 *
 * Realised P&L uses FIFO: sells consume the oldest open lots first. That is
 * the convention most brokers default to and the only one that gives a stable
 * answer without extra user input — the lot records stay intact either way, so
 * swapping in LIFO later is a change to this function alone.
 */

export interface OpenLot {
  tradeId: string;
  ticker: string;
  date: string;
  /** Shares still open after FIFO matching. */
  quantity: number;
  price: number;
  fees: number;
  currentPrice: number | null;
  value: number;
  pnl: number;
  pnlPct: number | null;
}

export interface VirtualPosition {
  ticker: string;
  shares: number;
  averageCost: number;
  costBasis: number;
  currentPrice: number | null;
  value: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number | null;
  dailyPnl: number;
  dailyPct: number | null;
  weight: number;
  realizedPnl: number;
  lots: OpenLot[];
  available: boolean;
}

export interface VirtualValuation {
  positions: VirtualPosition[];
  cash: number;
  investedValue: number;
  totalValue: number;
  costBasis: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalPnl: number;
  dailyPnl: number;
  dailyPct: number;
  /** Total return against the cash originally deposited. */
  returnPct: number;
  unavailable: string[];
  currency: string;
}

const asc = (a: Trade, b: Trade) =>
  a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date);

export function valueVirtual(
  portfolio: VirtualPortfolio,
  quotes: Record<string, Quote | undefined>,
): VirtualValuation {
  const byTicker = new Map<string, Trade[]>();
  for (const t of portfolio.trades) {
    byTicker.set(t.ticker, [...(byTicker.get(t.ticker) ?? []), t]);
  }

  const positions: VirtualPosition[] = [];
  const unavailable: string[] = [];
  let realizedTotal = 0;

  for (const [ticker, trades] of byTicker) {
    const open: { tradeId: string; date: string; qty: number; price: number; fees: number }[] = [];
    let realized = 0;

    for (const t of [...trades].sort(asc)) {
      if (t.side === "BUY") {
        open.push({
          tradeId: t.id,
          date: t.date,
          qty: t.quantity,
          price: t.price,
          fees: t.fees,
        });
        continue;
      }

      // FIFO: consume the oldest open lots first.
      let remaining = t.quantity;
      const proceedsPerShare = t.price - t.fees / Math.max(t.quantity, 1e-9);
      while (remaining > 1e-9 && open.length > 0) {
        const lot = open[0];
        const take = Math.min(remaining, lot.qty);
        const costPerShare = lot.price + lot.fees / Math.max(lot.qty, 1e-9);
        realized += take * (proceedsPerShare - costPerShare);
        lot.qty -= take;
        remaining -= take;
        if (lot.qty <= 1e-9) open.shift();
      }
    }

    realizedTotal += realized;

    const shares = open.reduce((s, l) => s + l.qty, 0);
    if (shares <= 1e-9) {
      // Fully closed. Its realised P&L still counts; it just holds no value.
      continue;
    }

    const quote = quotes[ticker];
    const price = quote?.price ?? null;
    if (price === null) unavailable.push(ticker);

    const costBasis = open.reduce(
      (s, l) => s + l.qty * (l.price + l.fees / Math.max(l.qty, 1e-9)),
      0,
    );
    const value = price === null ? 0 : shares * price;
    const dailyPct = quote?.changePercent ?? null;

    positions.push({
      ticker,
      shares,
      averageCost: costBasis / shares,
      costBasis,
      currentPrice: price,
      value,
      unrealizedPnl: price === null ? 0 : value - costBasis,
      unrealizedPnlPct: price === null || costBasis <= 0 ? null : (value / costBasis - 1) * 100,
      // Yesterday's close implied by today's percent move.
      dailyPnl:
        price === null || dailyPct === null
          ? 0
          : value - value / (1 + dailyPct / 100),
      dailyPct,
      weight: 0,
      realizedPnl: realized,
      available: price !== null,
      lots: open.map((l) => ({
        tradeId: l.tradeId,
        ticker,
        date: l.date,
        quantity: l.qty,
        price: l.price,
        fees: l.fees,
        currentPrice: price,
        value: price === null ? 0 : l.qty * price,
        pnl: price === null ? 0 : l.qty * (price - l.price) - l.fees,
        pnlPct: price === null ? null : (price / l.price - 1) * 100,
      })),
    });
  }

  const investedValue = positions.reduce((s, p) => s + p.value, 0);
  const totalValue = investedValue + portfolio.cash;
  for (const p of positions) p.weight = totalValue > 0 ? p.value / totalValue : 0;

  const costBasis = positions.reduce((s, p) => s + p.costBasis, 0);
  const unrealizedPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
  const dailyPnl = positions.reduce((s, p) => s + p.dailyPnl, 0);
  const prevValue = totalValue - dailyPnl;

  return {
    positions: positions.sort((a, b) => b.value - a.value),
    cash: portfolio.cash,
    investedValue,
    totalValue,
    costBasis,
    unrealizedPnl,
    realizedPnl: realizedTotal,
    totalPnl: unrealizedPnl + realizedTotal,
    dailyPnl,
    dailyPct: prevValue > 0 ? (dailyPnl / prevValue) * 100 : 0,
    returnPct:
      portfolio.initialCash > 0 ? (totalValue / portfolio.initialCash - 1) * 100 : 0,
    unavailable,
    currency: portfolio.currency,
  };
}

/**
 * Daily value series from the trade ledger and real candles.
 *
 * Walks the date axis holding whatever shares the ledger says were held on
 * that day, so the curve starts flat at the deposit and only moves once the
 * first trade settles. Nothing is computed before the portfolio existed.
 */
export function virtualSeries(
  portfolio: VirtualPortfolio,
  candles: Record<string, Candle[]>,
): Point[] {
  if (portfolio.trades.length === 0) return [];

  const sorted = [...portfolio.trades].sort(asc);
  const start = sorted[0].date;

  const priceMap = new Map<string, Map<string, number>>();
  const dates = new Set<string>();
  for (const [ticker, cs] of Object.entries(candles)) {
    const m = new Map<string, number>();
    for (const c of cs) {
      if (c.date < start) continue;
      m.set(c.date, c.close);
      dates.add(c.date);
    }
    priceMap.set(ticker, m);
  }
  if (dates.size === 0) return [];

  const axis = [...dates].sort();
  const lastKnown = new Map<string, number>();
  const shares = new Map<string, number>();
  let cash = portfolio.initialCash;
  let tradeIndex = 0;

  const out: Point[] = [];
  for (const date of axis) {
    // Apply every trade dated on or before this bar.
    while (tradeIndex < sorted.length && sorted[tradeIndex].date <= date) {
      const t = sorted[tradeIndex++];
      const gross = t.quantity * t.price;
      if (t.side === "BUY") {
        shares.set(t.ticker, (shares.get(t.ticker) ?? 0) + t.quantity);
        cash -= gross + t.fees;
      } else {
        shares.set(t.ticker, (shares.get(t.ticker) ?? 0) - t.quantity);
        cash += gross - t.fees;
      }
    }

    let invested = 0;
    for (const [ticker, qty] of shares) {
      if (qty <= 1e-9) continue;
      const px = priceMap.get(ticker)?.get(date) ?? lastKnown.get(ticker);
      if (px === undefined) continue;
      lastKnown.set(ticker, px);
      invested += qty * px;
    }
    // Carry forward any price we have seen, so a holiday in one series does
    // not knock a position out of the total for that day.
    for (const [ticker, m] of priceMap) {
      const px = m.get(date);
      if (px !== undefined) lastKnown.set(ticker, px);
    }

    out.push({ date, close: invested + cash });
  }

  return out;
}
