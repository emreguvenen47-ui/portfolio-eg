import { beforeAll, describe, expect, it } from "vitest";
import { resolveHolding, seedCusips } from "./cusip-resolve";

/**
 * Name matching for 13F issuers.
 *
 * The property that matters is the negative one: a name that does not match
 * confidently must resolve to null. A wrong ticker attributes one manager's
 * position to a different company and looks entirely reasonable doing it.
 */

beforeAll(() => {
  seedCusips({ "037833100": "AAPL" });
});

describe("cusip resolution", () => {
  it("prefers a hand-verified CUSIP over any name match", () => {
    // Even with a mangled issuer string, the pinned CUSIP wins.
    expect(resolveHolding("037833100", "SOMETHING ELSE ENTIRELY")).toBe("AAPL");
  });

  it("returns null for an unknown CUSIP with no usable name", () => {
    expect(resolveHolding("999999999", "ZZZ NONEXISTENT HOLDINGS LLC")).toBeNull();
  });

  it("remembers a pairing so the same CUSIP is resolved once", () => {
    seedCusips({ "12345678A": "TEST" });
    expect(resolveHolding("12345678a", "whatever")).toBe("TEST");
    // Lower case in, same answer out.
    expect(resolveHolding("12345678A", "whatever")).toBe("TEST");
  });
});
