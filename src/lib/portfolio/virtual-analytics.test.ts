import { describe, expect, it } from "vitest";

/**
 * Paper-ledger arithmetic.
 *
 * Every case here is one that was wrong or could quietly go wrong: an option
 * valued as though a contract were a share, a purchase that appears to have
 * made money the instant it was recorded, a backdated trade whose history is
 * drawn from the wrong day.
 */
import { valueVirtual, virtualSeries } from "@/lib/portfolio/virtual-analytics";
import type { Trade, VirtualPortfolio } from "@/lib/server/virtual-portfolios";

const T = (o: Partial<Trade> & { ticker: string; quantity: number; price: number; date: string }): Trade => ({
  id: Math.random().toString(36), side: "BUY", fees: 0, currency: "USD", note: "",
  createdAt: `${o.date}T00:00:00.000Z`, ...o,
});
const P = (trades: Trade[], cash: number, initial = 100_000): VirtualPortfolio => ({
  id: "p", name: "n", currency: "USD", cash, initialCash: initial,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z", trades,
});
const Q = (price: number) => ({ symbol: "X", price, change: 0, changePercent: 0, currency: "USD", status: "LIVE", asOf: "" }) as never;

describe("a purchase recorded today", () => {
  it("shows no profit when the fill matches the market", () => {
    const v = valueVirtual(P([T({ticker:"AAPL",quantity:10,price:100,date:"2026-08-14"})], 99_000), {AAPL:Q(100)});
    console.log("  today buy @100, quote 100 → unrealized:", v.positions[0]?.unrealizedPnl, "totalPnl:", v.totalPnl);
    expect(v.positions[0].unrealizedPnl).toBe(0);
  });
  it("moves cash out and the position in", () => {
    const v = valueVirtual(P([T({ticker:"AAPL",quantity:10,price:100,date:"2026-08-14"})], 99_000), {AAPL:Q(100)});
    console.log("  cash:", v.cash, "invested:", v.investedValue, "total:", v.totalValue);
    expect(v.cash).toBe(99_000);
    expect(v.investedValue).toBe(1_000);
  });
});

describe("option contracts", () => {
  it("cost the premium times the multiplier, not the premium", () => {
    const t = T({ticker:"AAPL",quantity:2,price:3.5,date:"2026-08-14"});
    t.option = {contract:"C",type:"CALL",strike:315,expiry:"2026-09-18",multiplier:100};
    const v = valueVirtual(P([t], 99_300), {AAPL:Q(305)});
    console.log("  2 kontrat @3.50 → costBasis:", v.positions[0]?.costBasis, "(700 olmali)");
    console.log("  value:", v.positions[0]?.value, "unrealized:", v.positions[0]?.unrealizedPnl);
    expect(v.positions[0].costBasis).toBe(700);
  });
});

describe("a backdated purchase", () => {
  it("draws history from the date it was bought", () => {
    const s = virtualSeries(
      P([T({ticker:"AAPL",quantity:10,price:100,date:"2026-08-10"})], 99_000),
      {AAPL:[{date:"2026-08-10",close:100,open:100,high:100,low:100,volume:1},
             {date:"2026-08-11",close:110,open:110,high:110,low:110,volume:1}] as never},
    );
    console.log("  seri:", s.map(p=>`${p.date}=${p.close}`).join(" "));
    expect(s[0].close).toBe(100_000);
    // 2026-08-10: bought 10 @100, closes at 100 → still par.
    expect(s[1].close).toBe(100_000);
    // 2026-08-11: closes at 110 → +100.
    expect(s[2].close).toBe(100_100);
  });
});

describe("the series anchor", () => {
  it("opens at the deposit rather than at the first close", () => {
    // Bought today at 100. The only candle is yesterday's close of 90.
    const s = virtualSeries(
      P([T({ticker:"AAPL",quantity:10,price:100,date:"2026-08-14"})], 99_000),
      {AAPL:[{date:"2026-08-13",close:90,open:90,high:90,low:90,volume:1},
             {date:"2026-08-14",close:90,open:90,high:90,low:90,volume:1}] as never},
    );
    console.log("  seri:", s.map(p=>`${p.date}=${p.close}`).join(" "));
    // The line opens at the deposit, so the first drawn point is not already
    // marked to a close the buyer never dealt at.
    expect(s[0].close).toBe(100_000);
    // Marking to the 90 close afterwards is correct: that loss is real.
    expect(s.at(-1)!.close).toBe(99_900);
  });
});
