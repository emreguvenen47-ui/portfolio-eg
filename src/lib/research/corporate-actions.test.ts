import { describe, expect, it } from "vitest";
import { detectSplit, findSuccessions, issuerKey } from "./corporate-actions";

/**
 * Both cases here are taken from real filings, because both were producing
 * confident nonsense at the top of a ranking.
 */

describe("split detection", () => {
  it("recognises the KLA five-for-one from the filings alone", () => {
    // BlackRock, 482480100: $1472.41 → $301.71 a share, 12.6M → 126.2M shares.
    const d = detectSplit(
      { shares: 12_596_207, value: 18_547_000_000 },
      { shares: 126_198_653, value: 38_075_000_000 },
    );
    expect(d.detected).toBe(true);
    expect(d.factor).toBe(5);
  });

  it("leaves the real position change visible after adjusting", () => {
    const prior = { shares: 12_596_207, value: 18_547_000_000 };
    const now = { shares: 126_198_653, value: 38_075_000_000 };
    const { factor } = detectSplit(prior, now);
    const adjusted = prior.shares * factor;
    const change = (now.shares - adjusted) / adjusted;
    // Roughly a doubling — not the +935% the raw counts implied.
    expect(change).toBeGreaterThan(0.9);
    expect(change).toBeLessThan(1.2);
  });

  it("does not mistake a price fall for a split", () => {
    // Halved in price, share count untouched: nobody split anything.
    const d = detectSplit({ shares: 1_000, value: 200_000 }, { shares: 1_000, value: 100_000 });
    expect(d.detected).toBe(false);
    expect(d.factor).toBe(1);
  });

  it("does not mistake buying for a split", () => {
    // Doubled the shares at an unchanged price. That is a purchase.
    const d = detectSplit({ shares: 1_000, value: 100_000 }, { shares: 2_000, value: 200_000 });
    expect(d.detected).toBe(false);
  });

  it("handles a reverse split", () => {
    const d = detectSplit({ shares: 10_000, value: 100_000 }, { shares: 1_000, value: 100_000 });
    expect(d.detected).toBe(true);
    expect(d.factor).toBeCloseTo(1 / 10, 6);
  });

  it("reports nothing usable when a reading is empty", () => {
    expect(detectSplit({ shares: 0, value: 0 }, { shares: 100, value: 1000 }).detected).toBe(false);
  });
});

describe("cusip succession", () => {
  const R = (issuer: string, shares: number, value: number) => ({ issuer, shares, value });

  it("matches the Honeywell spinoff rather than reporting an exit", () => {
    // 438516106 at $226.03 becomes two lines at $221.08 and $223.90.
    const prior = new Map([["438516106", R("HONEYWELL INTL INC", 48_875_976, 11_047_000_000)]]);
    const now = new Map([
      ["43849R105", R("HONEYWELL INTERNATIONAL", 23_762_174, 5_253_000_000)],
      ["438516205", R("HONEYWELL INTL INC NEW", 22_778_297, 5_100_000_000)],
    ]);
    const s = findSuccessions(prior, now);
    expect(s).toHaveLength(1);
    expect(s[0].to.sort()).toEqual(["43849R105", "438516205"]);
  });

  it("leaves a genuine exit alone", () => {
    const prior = new Map([["111111111", R("SOME COMPANY INC", 1_000, 100_000)]]);
    const now = new Map([["222222222", R("ENTIRELY DIFFERENT CORP", 500, 50_000)]]);
    expect(findSuccessions(prior, now)).toHaveLength(0);
  });

  it("refuses to merge two share classes priced differently", () => {
    // Same issuer, but a $10 line is not the same holding as a $200 one.
    const prior = new Map([["111111111", R("ACME CORP", 1_000, 200_000)]]);
    const now = new Map([["222222222", R("ACME CORP WARRANTS", 1_000, 10_000)]]);
    expect(findSuccessions(prior, now)).toHaveLength(0);
  });

  it("normalises an issuer to its leading words", () => {
    expect(issuerKey("HONEYWELL INTL INC")).toBe(issuerKey("Honeywell Intl Inc. New"));
    expect(issuerKey("APPLE INC")).not.toBe(issuerKey("APPLIED MATERIALS INC"));
  });
});

describe("splits that arrive alongside a price move", () => {
  it("catches the Booking twenty-for-one despite a 15% fall", () => {
    // $4210.32 → $178.24 a share, 4.78M → 110.2M shares.
    const d = detectSplit(
      { shares: 4_778_525, value: 20_119_000_000 },
      { shares: 110_233_196, value: 19_648_000_000 },
    );
    expect(d.detected).toBe(true);
    expect(d.factor).toBe(20);
  });

  it("reports the real position change once adjusted", () => {
    const prior = { shares: 4_778_525, value: 20_119_000_000 };
    const now = { shares: 110_233_196, value: 19_648_000_000 };
    const adjusted = prior.shares * detectSplit(prior, now).factor;
    const change = (now.shares - adjusted) / adjusted;
    // A small add, not the 2,207% the raw counts implied.
    expect(Math.abs(change)).toBeLessThan(0.2);
  });

  it("still refuses a wide price move with an unchanged share count", () => {
    // Down 60% and nobody traded: not a split, whatever the price ratio says.
    const d = detectSplit({ shares: 1_000, value: 250_000 }, { shares: 1_000, value: 100_000 });
    expect(d.detected).toBe(false);
  });

  it("still refuses a genuine tripling of the position", () => {
    const d = detectSplit({ shares: 1_000, value: 100_000 }, { shares: 3_000, value: 300_000 });
    expect(d.detected).toBe(false);
  });
});
