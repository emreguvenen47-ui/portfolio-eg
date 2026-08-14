import { describe, expect, it } from "vitest";
import { greeks, yearsToExpiry } from "./greeks";

/**
 * Checked against textbook Black-Scholes values and against the identities
 * the formula must satisfy. A greek that looks plausible but has the wrong
 * sign is worse than no greek at all.
 */

const base = { spot: 100, strike: 100, years: 1, iv: 0.2, rate: 0.05 } as const;

describe("black-scholes greeks", () => {
  it("prices a textbook at-the-money call", () => {
    // S=100 K=100 T=1 σ=20% r=5% → 10.4506 in every reference table.
    const g = greeks({ ...base, type: "CALL" })!;
    expect(g.theoretical).toBeCloseTo(10.4506, 3);
  });

  it("prices the matching put", () => {
    const g = greeks({ ...base, type: "PUT" })!;
    expect(g.theoretical).toBeCloseTo(5.5735, 3);
  });

  it("satisfies put-call parity", () => {
    const c = greeks({ ...base, type: "CALL" })!;
    const p = greeks({ ...base, type: "PUT" })!;
    // C − P = S − K·e^(−rT)
    const lhs = c.theoretical - p.theoretical;
    const rhs = base.spot - base.strike * Math.exp(-base.rate * base.years);
    expect(lhs).toBeCloseTo(rhs, 6);
  });

  it("gives call delta in (0,1) and put delta in (−1,0)", () => {
    expect(greeks({ ...base, type: "CALL" })!.delta).toBeCloseTo(0.6368, 3);
    expect(greeks({ ...base, type: "PUT" })!.delta).toBeCloseTo(-0.3632, 3);
  });

  it("shares gamma and vega between a call and its put", () => {
    const c = greeks({ ...base, type: "CALL" })!;
    const p = greeks({ ...base, type: "PUT" })!;
    expect(c.gamma).toBeCloseTo(p.gamma, 9);
    expect(c.vega).toBeCloseTo(p.vega, 9);
  });

  it("decays a long option — theta is negative", () => {
    expect(greeks({ ...base, type: "CALL" })!.theta).toBeLessThan(0);
    expect(greeks({ ...base, type: "PUT" })!.theta).toBeLessThan(0);
  });

  it("moves deep in and out of the money to the delta limits", () => {
    expect(greeks({ ...base, spot: 300, type: "CALL" })!.delta).toBeGreaterThan(0.99);
    expect(greeks({ ...base, spot: 20, type: "CALL" })!.delta).toBeLessThan(0.01);
  });

  it("returns nothing rather than a number when an input is unusable", () => {
    // No implied volatility published: no greeks. Solving for one that fits a
    // stale print would be inventing the measurement.
    expect(greeks({ ...base, iv: 0, type: "CALL" })).toBeNull();
    expect(greeks({ ...base, years: 0, type: "CALL" })).toBeNull();
    expect(greeks({ ...base, spot: 0, type: "CALL" })).toBeNull();
    expect(greeks({ ...base, iv: Number.NaN, type: "CALL" })).toBeNull();
  });

  it("says out loud that dividends are not modelled", () => {
    expect(greeks({ ...base, type: "CALL" })!.assumesNoDividend).toBe(true);
  });

  it("keeps expiry day non-zero so greeks still compute", () => {
    const y = yearsToExpiry("2026-08-14", new Date("2026-08-14T18:00:00Z"));
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(0.01);
  });
});

describe("placeholder volatility", () => {
  it("refuses the near-zero IV a closed venue publishes", () => {
    // Yahoo returns 1e-5 out of hours. Run through the formula it yields a
    // delta of 1.000 and a price nowhere near the quoted mark.
    expect(greeks({ ...base, iv: 0.00001, type: "CALL" })).toBeNull();
    expect(greeks({ ...base, iv: 0.005, type: "CALL" })).toBeNull();
  });

  it("still accepts a genuinely quiet but real volatility", () => {
    expect(greeks({ ...base, iv: 0.01, type: "CALL" })).not.toBeNull();
  });
});
