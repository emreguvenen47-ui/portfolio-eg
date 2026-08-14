import type { Portfolio, Position } from "@/lib/types";
import { tradeNotional, type Trade, type VirtualPortfolio } from "@/lib/server/virtual-portfolios";

/**
 * Turn a paper-trading ledger into a portfolio the analytics can read.
 *
 * Once somebody has built a real book in Paper Trading, showing them a sample
 * on Overview is worse than showing nothing: it is their own app telling them
 * their work does not count. So a paper portfolio takes precedence over the
 * sample — while still ranking below an uploaded workbook, which is the
 * statement of what they actually own.
 *
 * What is derived and what is not:
 *
 * - Quantities and cost basis come from the lots, netted on read only. The
 *   ledger keeps every lot; this does not modify it.
 * - Weights are cost-basis weights, because that is what the ledger knows. The
 *   market values that produce current weights are computed downstream from
 *   live quotes, exactly as they are for an uploaded workbook.
 * - Expected return and volatility are left at zero rather than guessed. They
 *   are workbook assumptions, and inventing them here would put made-up
 *   numbers into the model-implied panels. Those panels read them as absent.
 */

export const PAPER_SOURCE = "paper-trading";

interface Lot {
  ticker: string;
  shares: number;
  cost: number;
}

/** Net the lots. Sells reduce shares and cost at the running average. */
function netPositions(trades: Trade[]): Lot[] {
  const byTicker = new Map<string, Lot>();

  // Chronological, so an average cost is the average at the time of the sale.
  const ordered = [...trades].sort((a, b) => a.date.localeCompare(b.date));

  for (const t of ordered) {
    const key = t.ticker.toUpperCase();
    const lot = byTicker.get(key) ?? { ticker: key, shares: 0, cost: 0 };

    if (t.side === "BUY") {
      lot.shares += t.quantity;
      lot.cost += tradeNotional(t) + t.fees;
    } else {
      const avg = lot.shares > 0 ? lot.cost / lot.shares : 0;
      const sold = Math.min(t.quantity, lot.shares);
      lot.shares -= sold;
      lot.cost -= avg * sold;
    }

    byTicker.set(key, lot);
  }

  // A closed position is not a holding.
  return [...byTicker.values()].filter((l) => l.shares > 1e-9 && l.cost > 0);
}

export function portfolioFromPaper(v: VirtualPortfolio): Portfolio | null {
  const lots = netPositions(v.trades);
  if (lots.length === 0) return null;

  const invested = lots.reduce((s, l) => s + l.cost, 0);
  const cash = Math.max(0, v.cash);
  const total = invested + cash;
  if (total <= 0) return null;

  const positions: Position[] = lots.map((l, i) => ({
    index: i,
    code: l.ticker,
    name: l.ticker,
    category: "Paper position",
    weight: l.cost / total,
    amount: Math.round(l.cost),
    // Not assumptions we have. Left absent rather than invented.
    expectedReturn: 0,
    volatility: 0,
    currency: v.currency,
    rationale: "",
    risks: "",
    assetClass: "Equity",
    region: "US",
    kind: "etf",
    symbol: l.ticker,
    isProxy: false,
    themes: [],
    targetWeight: l.cost / total,
    currencyCode: v.currency === "TRY" ? "TRY" : "USD",
  }));

  // Uninvested cash is a position too; leaving it out would overstate every
  // weight and understate the cash the risk panels care about.
  if (cash > 0) {
    positions.push({
      index: positions.length,
      code: "CASH",
      name: "Cash",
      category: "Cash",
      weight: cash / total,
      amount: Math.round(cash),
      expectedReturn: 0,
      volatility: 0,
      currency: v.currency,
      rationale: "",
      risks: "",
      assetClass: "Cash",
      region: "US",
      kind: "cash_fund",
      symbol: null,
      isProxy: false,
      themes: [],
      targetWeight: cash / total,
      currencyCode: v.currency === "TRY" ? "TRY" : "USD",
    });
  }

  return {
    meta: {
      title: v.name,
      baseCurrency: "USD",
      totalAmount: Math.round(total),
      sourceFile: PAPER_SOURCE,
      parsedAt: v.updatedAt,
      summary: {},
      warnings: [
        "Derived from your paper-trading ledger. Prices and risk are real; the " +
          "positions are simulated trades, not a brokerage statement.",
      ],
    },
    positions,
  };
}

/** True when a portfolio came from the paper ledger rather than a workbook. */
export const isPaperPortfolio = (p: Portfolio): boolean =>
  p.meta.sourceFile === PAPER_SOURCE;
