import type { InsiderTx } from "@/lib/providers/fundamentals";

/**
 * Insider intelligence.
 *
 * The whole point of this module is the distinction between an insider
 * *deciding* to buy or sell and an insider *receiving* or *surrendering*
 * shares mechanically. Most Form 4 volume at a large company is the latter:
 * RSUs vesting, shares withheld to cover the tax on that vesting, options
 * being exercised. Counting those as "insider selling" is the single most
 * common way this data is read wrong, and it makes almost every large-cap look
 * permanently bearish.
 *
 * SEC Form 4 transaction codes carry the distinction directly, so the
 * classification below is a lookup rather than a guess. Everything here is
 * arithmetic over reported filings — no model, no estimation.
 */

export type InsiderKind =
  | "OPEN_MARKET_BUY"
  | "OPEN_MARKET_SELL"
  | "OPTION_EXERCISE"
  | "STOCK_AWARD"
  | "TAX_WITHHOLDING"
  | "GIFT"
  | "OTHER";

/**
 * Form 4 codes.
 *
 * P and S are the discretionary ones — an open-market purchase or sale. The
 * rest are plumbing: M is an option/derivative conversion, A a grant, F shares
 * handed back to cover withholding tax, G a gift.
 */
const CODE_MAP: Record<string, InsiderKind> = {
  P: "OPEN_MARKET_BUY",
  S: "OPEN_MARKET_SELL",
  M: "OPTION_EXERCISE",
  X: "OPTION_EXERCISE",
  C: "OPTION_EXERCISE",
  A: "STOCK_AWARD",
  F: "TAX_WITHHOLDING",
  G: "GIFT",
  D: "OTHER",
  I: "OTHER",
  J: "OTHER",
  K: "OTHER",
  U: "OTHER",
  W: "OTHER",
};

export const KIND_LABEL: Record<InsiderKind, string> = {
  OPEN_MARKET_BUY: "Open-market purchase",
  OPEN_MARKET_SELL: "Open-market sale",
  OPTION_EXERCISE: "Option exercise",
  STOCK_AWARD: "Stock award",
  TAX_WITHHOLDING: "Tax withholding",
  GIFT: "Gift",
  OTHER: "Other",
};

/** Only these two reflect a decision to put money in or take it out. */
export const isDiscretionary = (k: InsiderKind) =>
  k === "OPEN_MARKET_BUY" || k === "OPEN_MARKET_SELL";

export interface InsiderRow {
  name: string;
  /** Not carried by the current provider — always null, shown as N/A. */
  title: string | null;
  date: string;
  filingDate: string;
  kind: InsiderKind;
  code: string | null;
  side: "BUY" | "SELL";
  shares: number;
  price: number | null;
  value: number | null;
  sharesAfter: number | null;
  /** Change as a share of the position held before the trade. */
  ownershipChangePct: number | null;
  isDerivative: boolean | null;
  /** Form 4 carries a 10b5-1 checkbox; this feed does not expose it. */
  plan10b51: boolean | null;
  /** Direct vs indirect (trust, LLC) holding — not exposed by this feed. */
  ownershipType: string | null;
}

export function classify(tx: InsiderTx): InsiderRow {
  const code = tx.transactionCode?.trim().toUpperCase() || null;
  let kind: InsiderKind = code ? (CODE_MAP[code] ?? "OTHER") : "OTHER";

  // A missing or unknown code still has a direction. Fall back to the sign of
  // the share change, but only as far as "OTHER" — never promote an unlabelled
  // filing to an open-market decision it may not be.
  const shares = Math.abs(tx.change);
  const side: "BUY" | "SELL" = tx.change >= 0 ? "BUY" : "SELL";
  const price = tx.transactionPrice > 0 ? tx.transactionPrice : null;

  // A zero price on a P or S is a filing artefact, not a free trade. Without a
  // price there is no dollar value, so it cannot count toward the flow totals.
  if (isDiscretionary(kind) && price === null) kind = "OTHER";

  const after = Number.isFinite(tx.share) ? tx.share : null;
  const before = after === null ? null : after - tx.change;

  return {
    name: tx.name,
    title: null,
    date: tx.transactionDate,
    filingDate: tx.filingDate,
    kind,
    code,
    side,
    shares,
    price,
    value: price === null ? null : shares * price,
    sharesAfter: after,
    ownershipChangePct: before && before > 0 ? (tx.change / before) * 100 : null,
    isDerivative: tx.isDerivative ?? null,
    plan10b51: null,
    ownershipType: null,
  };
}

export interface InsiderWindow {
  label: string;
  days: number;
  buyCount: number;
  sellCount: number;
  uniqueBuyers: number;
  uniqueSellers: number;
  buyValue: number;
  sellValue: number;
  netValue: number;
  /** Distinct insiders buying on the open market within the window. */
  clusterBuyers: number;
  clusterBuying: boolean;
}

export type InsiderSignal =
  | "STRONG BUYING"
  | "BUYING"
  | "NEUTRAL"
  | "SELLING"
  | "STRONG SELLING";

export interface InsiderReport {
  rows: InsiderRow[];
  windows: InsiderWindow[];
  signal: InsiderSignal;
  /** Plain-language account of what drove the signal. */
  rationale: string;
  /** Purchases that were large relative to what the insider already held. */
  notableBuys: { name: string; date: string; value: number; ownershipChangePct: number }[];
  mechanicalCount: number;
}

const DAY = 86_400_000;

/** Two or more distinct insiders buying on the open market inside 90 days. */
const CLUSTER_MIN_BUYERS = 2;
/** Ignore token purchases so a single $500 trade cannot manufacture a cluster. */
const MEANINGFUL_BUY_USD = 25_000;

function summarise(rows: InsiderRow[], label: string, days: number, now: number): InsiderWindow {
  const cutoff = now - days * DAY;
  const inWindow = rows.filter((r) => {
    const t = Date.parse(r.date);
    return Number.isFinite(t) && t >= cutoff;
  });

  const buys = inWindow.filter((r) => r.kind === "OPEN_MARKET_BUY");
  const sells = inWindow.filter((r) => r.kind === "OPEN_MARKET_SELL");
  const meaningful = buys.filter((b) => (b.value ?? 0) >= MEANINGFUL_BUY_USD);
  const clusterBuyers = new Set(meaningful.map((b) => b.name)).size;

  const sum = (xs: InsiderRow[]) => xs.reduce((s, x) => s + (x.value ?? 0), 0);
  const buyValue = sum(buys);
  const sellValue = sum(sells);

  return {
    label,
    days,
    buyCount: buys.length,
    sellCount: sells.length,
    uniqueBuyers: new Set(buys.map((b) => b.name)).size,
    uniqueSellers: new Set(sells.map((s) => s.name)).size,
    buyValue,
    sellValue,
    netValue: buyValue - sellValue,
    clusterBuyers,
    // Only meaningful inside a reasonably tight window; a year of scattered
    // purchases from different people is not a cluster.
    clusterBuying: days <= 90 && clusterBuyers >= CLUSTER_MIN_BUYERS,
  };
}

export function analyseInsiders(txs: InsiderTx[], now = Date.now()): InsiderReport {
  const rows = txs
    .map(classify)
    .sort((a, b) => b.date.localeCompare(a.date));

  const windows = [
    summarise(rows, "30D", 30, now),
    summarise(rows, "90D", 90, now),
    summarise(rows, "1Y", 365, now),
  ];

  const w90 = windows[1];
  const w365 = windows[2];

  // A purchase that materially increases what an insider already owns says
  // more than a large absolute number from someone who holds far more.
  const notableBuys = rows
    .filter(
      (r) =>
        r.kind === "OPEN_MARKET_BUY" &&
        Date.parse(r.date) >= now - 365 * DAY &&
        (r.ownershipChangePct ?? 0) >= 10 &&
        (r.value ?? 0) >= MEANINGFUL_BUY_USD,
    )
    .map((r) => ({
      name: r.name,
      date: r.date,
      value: r.value!,
      ownershipChangePct: r.ownershipChangePct!,
    }))
    .slice(0, 5);

  const { signal, rationale } = score(w90, w365, notableBuys.length);

  return {
    rows,
    windows,
    signal,
    rationale,
    notableBuys,
    mechanicalCount: rows.filter((r) => !isDiscretionary(r.kind)).length,
  };
}

/**
 * Deterministic signal.
 *
 * Buying is weighted more heavily than selling, and deliberately so: an
 * insider sells for reasons that have nothing to do with the business — a
 * house, a divorce, plain diversification — but buys for essentially one.
 * Selling therefore has to be both large and broad before it reads as a
 * negative, while a genuine cluster of purchases reads as a positive quickly.
 */
function score(
  w90: InsiderWindow,
  w365: InsiderWindow,
  notable: number,
): { signal: InsiderSignal; rationale: string } {
  const flow = w90.buyValue + w90.sellValue;

  if (flow === 0 && w365.buyCount === 0 && w365.sellCount === 0) {
    return {
      signal: "NEUTRAL",
      rationale: "No open-market insider transactions on file in the last year.",
    };
  }

  if (flow === 0) {
    return {
      signal: "NEUTRAL",
      rationale:
        "No open-market insider activity in the last 90 days; only awards, exercises or withholding.",
    };
  }

  // Share of 90-day open-market dollar flow that was buying.
  const buyShare = w90.buyValue / flow;

  if (w90.clusterBuying && buyShare > 0.5) {
    return {
      signal: "STRONG BUYING",
      rationale: `${w90.clusterBuyers} different insiders bought on the open market within 90 days${
        notable > 0 ? `, including ${notable} purchase${notable > 1 ? "s" : ""} that materially increased their holding` : ""
      }.`,
    };
  }
  if (buyShare >= 0.8) {
    return {
      signal: "BUYING",
      rationale: `Open-market flow over 90 days was ${(buyShare * 100).toFixed(0)}% purchases across ${w90.uniqueBuyers} insider${w90.uniqueBuyers === 1 ? "" : "s"}.`,
    };
  }
  if (buyShare <= 0.05 && w90.uniqueSellers >= 3) {
    return {
      signal: "STRONG SELLING",
      rationale: `${w90.uniqueSellers} insiders sold on the open market in 90 days with essentially no offsetting purchases.`,
    };
  }
  if (buyShare <= 0.2) {
    return {
      signal: "SELLING",
      rationale: `Open-market flow over 90 days was ${(100 - buyShare * 100).toFixed(0)}% sales across ${w90.uniqueSellers} insider${w90.uniqueSellers === 1 ? "" : "s"}.`,
    };
  }
  return {
    signal: "NEUTRAL",
    rationale: `Open-market buying and selling were roughly balanced over 90 days (${(buyShare * 100).toFixed(0)}% buys by value).`,
  };
}
