import { describe, expect, it } from "vitest";
import { tradeNotional, type Trade } from "./virtual-portfolios";

/**
 * The multiplier.
 *
 * An option premium is quoted per share and settles per contract, so cash is
 * premium × contracts × 100. Every site that computes trade value shares one
 * helper precisely because getting this wrong is not a rounding error — it is
 * a ledger off by two orders of magnitude, in a direction that looks
 * plausible until it does not.
 */

const base: Omit<Trade, "option"> = {
  id: "t1",
  ticker: "AAPL",
  side: "BUY",
  quantity: 2,
  price: 3.5,
  fees: 0,
  currency: "USD",
  date: "2026-08-14",
  note: "",
  createdAt: "2026-08-14T00:00:00.000Z",
};

describe("trade notional", () => {
  it("treats a share trade as quantity times price", () => {
    expect(tradeNotional(base as Trade)).toBe(7);
  });

  it("applies the contract multiplier to an option", () => {
    const t: Trade = {
      ...base,
      option: {
        contract: "AAPL260814C00315000",
        type: "CALL",
        strike: 315,
        expiry: "2026-08-14",
        multiplier: 100,
      },
    };
    // Two contracts at $3.50 per share is $700, not $7.
    expect(tradeNotional(t)).toBe(700);
  });

  it("honours a non-standard multiplier rather than assuming 100", () => {
    const t: Trade = {
      ...base,
      option: {
        contract: "X",
        type: "PUT",
        strike: 10,
        expiry: "2026-09-18",
        multiplier: 10,
      },
    };
    expect(tradeNotional(t)).toBe(70);
  });

  it("leaves pre-existing share trades unchanged", () => {
    // A ledger written before options existed has no `option` field at all.
    const legacy = JSON.parse(JSON.stringify(base)) as Trade;
    expect(tradeNotional(legacy)).toBe(7);
  });
});
