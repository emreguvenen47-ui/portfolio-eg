import { describe, expect, it } from "vitest";
import {
  crossCheck,
  GROWTH_TOLERANCE,
  PERCENT_TOLERANCE,
  RATIO_TOLERANCE,
} from "./cross-check";

/**
 * The rule under test: a number nobody corroborated must not look like one
 * that two sources confirmed, and a disagreement must not be averaged away.
 */

describe("cross-checking two sources", () => {
  it("confirms readings that agree", () => {
    const r = crossCheck(22.4, 22.1);
    expect(r.agreement).toBe("CONFIRMED");
    expect(r.value).toBeCloseTo(22.4);
  });

  it("marks a lone reading as single-source rather than confirmed", () => {
    expect(crossCheck(22.4, null).agreement).toBe("SINGLE_SOURCE");
    expect(crossCheck(null, 22.4).agreement).toBe("SINGLE_SOURCE");
    // Still usable — just not corroborated.
    expect(crossCheck(null, 22.4).value).toBe(22.4);
  });

  it("reports nothing when neither source has it", () => {
    const r = crossCheck(null, undefined);
    expect(r.agreement).toBe("MISSING");
    expect(r.value).toBeNull();
  });

  it("flags a definitional mismatch rather than picking quietly", () => {
    // The shape of the bank revenue-growth bug: 109% against 6%.
    const r = crossCheck(6.2, 109, GROWTH_TOLERANCE);
    expect(r.agreement).toBe("DISPUTED");
    expect(r.filed).toBe(6.2);
    expect(r.reported).toBe(109);
  });

  it("prefers the filed figure when the two disagree", () => {
    const r = crossCheck(6.2, 109, GROWTH_TOLERANCE);
    expect(r.value).toBe(6.2);
  });

  it("never averages two disagreeing sources into a third number", () => {
    const r = crossCheck(10, 30);
    expect(r.value).not.toBeCloseTo(20);
    expect([10, 30]).toContain(r.value);
  });

  it("scales tolerance with magnitude", () => {
    // Two points apart on a 4% margin is a real difference…
    expect(crossCheck(4, 6.2).agreement).toBe("DISPUTED");
    // …and on a 60% margin it is not.
    expect(crossCheck(60, 62).agreement).toBe("CONFIRMED");
  });

  it("uses a tighter band for plain ratios than for percentages", () => {
    // Current ratio 1.8 vs 2.1: a real difference on a ratio scale.
    expect(crossCheck(1.8, 2.1, RATIO_TOLERANCE).agreement).toBe("DISPUTED");
    expect(crossCheck(1.8, 2.1, PERCENT_TOLERANCE).agreement).toBe("CONFIRMED");
  });

  it("records the spread so a panel can show how far apart they were", () => {
    expect(crossCheck(6.2, 109, GROWTH_TOLERANCE).spread).toBeCloseTo(102.8);
    expect(crossCheck(6.2, null).spread).toBeNull();
  });
});
