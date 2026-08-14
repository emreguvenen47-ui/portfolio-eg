import "server-only";
import { randomUUID } from "node:crypto";
import { ownerOrRefuse } from "./auth";
import { useFallback } from "./supabase";
import { devCollection } from "./dev-store";

/**
 * Virtual (paper) portfolios.
 *
 * Trades are stored as individual lots and never netted on write. Averaging on
 * the way in would destroy the information the ledger exists for — which lot
 * is up, which is down, when each was opened — and there is no way to recover
 * it afterwards. Aggregates are derived on read instead.
 *
 * Paper tracking only: nothing here places an order or talks to a broker.
 */

export type TradeSide = "BUY" | "SELL";

/**
 * An option leg, when the trade is a contract rather than shares.
 *
 * Present only on option trades; a share trade leaves it undefined, so every
 * ledger written before options existed still reads correctly.
 *
 * `multiplier` is stored rather than assumed. It is 100 for standard US
 * equity options and the ledger would be wrong by two orders of magnitude if
 * a non-standard contract were valued as though it were not.
 */
export interface OptionLeg {
  /** OCC-style contract symbol, e.g. AAPL260814C00315000. */
  contract: string;
  type: "CALL" | "PUT";
  strike: number;
  /** yyyy-mm-dd. */
  expiry: string;
  /** Shares per contract. */
  multiplier: number;
}

export interface Trade {
  id: string;
  ticker: string;
  side: TradeSide;
  /**
   * Shares, or contracts when `option` is set. Always positive; `side` carries
   * the direction.
   */
  quantity: number;
  /**
   * Execution price per share, or premium per share for an option — not per
   * contract. Quoted the way the chain quotes it, so the two never need
   * reconciling; the multiplier turns it into cash.
   */
  price: number;
  fees: number;
  currency: string;
  /** Trade date, yyyy-mm-dd. */
  date: string;
  note: string;
  createdAt: string;
  /** Set when this trade is an option contract rather than shares. */
  option?: OptionLeg;
}

/** Cash a trade moves, respecting the contract multiplier. */
export const tradeNotional = (t: Trade): number =>
  t.quantity * t.price * (t.option?.multiplier ?? 1);

export interface VirtualPortfolio {
  id: string;
  name: string;
  currency: string;
  /** Uninvested cash, moved by every trade. */
  cash: number;
  /** Cash deposited at creation — the denominator for total return. */
  initialCash: number;
  createdAt: string;
  updatedAt: string;
  trades: Trade[];
  /** Set when this was seeded from a saved AI portfolio. */
  sourceAiPortfolioId?: string;
}

const TABLE = "virtual_portfolios";

/**
 * Fallback store, used when Supabase is unavailable.
 *
 * Disk-backed rather than memory-only: a paper ledger that vanishes on every
 * dev server restart is worse than useless, because the user has no way to
 * tell a restart from a bug. Supabase is still the real store when its tables
 * exist.
 */
const memory = devCollection<VirtualPortfolio>("virtual-portfolios");

function toRow(p: VirtualPortfolio) {
  return {
    id: p.id,
    name: p.name,
    currency: p.currency,
    cash: p.cash,
    initial_cash: p.initialCash,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    trades: p.trades,
    source_ai_portfolio_id: p.sourceAiPortfolioId ?? null,
  };
}

function fromRow(r: Record<string, unknown>): VirtualPortfolio {
  return {
    id: String(r.id),
    name: String(r.name ?? "Untitled"),
    currency: String(r.currency ?? "USD"),
    cash: Number(r.cash ?? 0),
    initialCash: Number(r.initial_cash ?? 0),
    createdAt: String(r.created_at ?? new Date().toISOString()),
    updatedAt: String(r.updated_at ?? new Date().toISOString()),
    trades: (r.trades ?? []) as Trade[],
    sourceAiPortfolioId: (r.source_ai_portfolio_id as string | null) ?? undefined,
  };
}

/**
 * A failed write throws rather than being absorbed by the memory copy. A trade
 * that reports success while the row never landed is worse than an error: the
 * ledger then disagrees with itself the moment the process restarts, and every
 * cost basis derived from it is quietly wrong.
 */
async function persist(p: VirtualPortfolio): Promise<VirtualPortfolio> {
  const owner = await ownerOrRefuse();
  if (owner) {
    const sb = owner.sb;
    const { error } = await sb.from(TABLE).upsert({ ...toRow(p), user_id: owner.userId });
    if (!error) return p;
    if (!useFallback(error, TABLE)) {
      throw new Error(`Failed to save paper portfolio: ${error.message}`);
    }
  }
  memory.set(p.id, p);
  return p;
}

export async function listVirtual(): Promise<VirtualPortfolio[]> {
  const owner = await ownerOrRefuse();
  if (owner) {
    const sb = owner.sb;
    const { data, error } = await sb
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: false });
    if (!error) return (data ?? []).map(fromRow);
    if (!useFallback(error, TABLE)) {
      throw new Error(`Failed to load paper portfolios: ${error.message}`);
    }
  }
  return memory.all().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getVirtual(id: string): Promise<VirtualPortfolio | null> {
  const owner = await ownerOrRefuse();
  if (owner) {
    const sb = owner.sb;
    const { data, error } = await sb.from(TABLE).select("*").eq("id", id).maybeSingle();
    if (!error) return data ? fromRow(data) : null;
    if (!useFallback(error, TABLE)) {
      throw new Error(`Failed to load paper portfolio: ${error.message}`);
    }
  }
  return memory.get(id) ?? null;
}

export async function createVirtual(input: {
  name: string;
  currency?: string;
  initialCash: number;
  sourceAiPortfolioId?: string;
  trades?: Omit<Trade, "id" | "createdAt">[];
}): Promise<VirtualPortfolio> {
  const now = new Date().toISOString();
  const trades: Trade[] = (input.trades ?? []).map((t) => ({
    ...t,
    id: randomUUID(),
    createdAt: now,
  }));

  // Seeding from an AI portfolio spends cash on the opening trades, so the
  // starting cash balance is what is left over rather than the full amount.
  const spent = trades.reduce(
    (s, t) =>
      s + (t.side === "BUY" ? tradeNotional(t) + t.fees : -(tradeNotional(t) - t.fees)),
    0,
  );

  return persist({
    id: randomUUID(),
    name: input.name,
    currency: input.currency ?? "USD",
    cash: input.initialCash - spent,
    initialCash: input.initialCash,
    createdAt: now,
    updatedAt: now,
    trades,
    sourceAiPortfolioId: input.sourceAiPortfolioId,
  });
}

export async function addTrade(
  id: string,
  input: Omit<Trade, "id" | "createdAt">,
): Promise<VirtualPortfolio | { error: string } | null> {
  const p = await getVirtual(id);
  if (!p) return null;

  const gross = input.quantity * input.price;

  if (input.side === "SELL") {
    // Refuse to sell more than is held. A paper ledger that allows a negative
    // share count silently produces nonsense average costs downstream.
    const held = sharesHeld(p, input.ticker);
    if (input.quantity > held + 1e-9) {
      return { error: `Cannot sell ${input.quantity} ${input.ticker} — only ${held} held` };
    }
  }

  const trade: Trade = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
  const cashDelta = input.side === "BUY" ? -(gross + input.fees) : gross - input.fees;

  return persist({
    ...p,
    cash: p.cash + cashDelta,
    updatedAt: new Date().toISOString(),
    trades: [...p.trades, trade],
  });
}

export async function deleteTrade(id: string, tradeId: string): Promise<VirtualPortfolio | null> {
  const p = await getVirtual(id);
  if (!p) return null;
  const trade = p.trades.find((t) => t.id === tradeId);
  if (!trade) return p;

  const gross = tradeNotional(trade as Trade);
  const cashDelta = trade.side === "BUY" ? gross + trade.fees : -(gross - trade.fees);

  return persist({
    ...p,
    cash: p.cash + cashDelta,
    updatedAt: new Date().toISOString(),
    trades: p.trades.filter((t) => t.id !== tradeId),
  });
}

export async function renameVirtual(id: string, name: string): Promise<VirtualPortfolio | null> {
  const p = await getVirtual(id);
  if (!p) return null;
  return persist({ ...p, name, updatedAt: new Date().toISOString() });
}

export async function deleteVirtual(id: string): Promise<boolean> {
  const owner = await ownerOrRefuse();
  if (owner) {
    const sb = owner.sb;
    const { error } = await sb.from(TABLE).delete().eq("id", id);
    if (!error) return true;
    if (!useFallback(error, TABLE)) {
      throw new Error(`Failed to delete paper portfolio: ${error.message}`);
    }
  }
  return memory.delete(id);
}

export function sharesHeld(p: VirtualPortfolio, ticker: string): number {
  return p.trades
    .filter((t) => t.ticker === ticker)
    .reduce((s, t) => s + (t.side === "BUY" ? t.quantity : -t.quantity), 0);
}
