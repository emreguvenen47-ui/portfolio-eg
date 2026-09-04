import { describe, expect, it } from "vitest";
import { cagr, classifyCompany, sumComplete, yoyGrowth } from "./company";

describe("sumComplete", () => {
  it("sums the newest n values when all present", () => {
    expect(sumComplete([4, 3, 2, 1, 99], 4)).toBe(10);
  });
  it("returns null when any of the n values is missing", () => {
    expect(sumComplete([4, null, 2, 1], 4)).toBeNull();
  });
  it("returns null when there are fewer than n rows", () => {
    expect(sumComplete([1, 2, 3], 4)).toBeNull();
  });
});

describe("yoyGrowth", () => {
  it("computes growth against a positive base", () => {
    expect(yoyGrowth(120, 100)).toBeCloseTo(0.2);
  });
  it("refuses a zero or negative base instead of inventing a sign", () => {
    expect(yoyGrowth(120, 0)).toBeNull();
    expect(yoyGrowth(120, -50)).toBeNull();
  });
  it("propagates missing inputs as null", () => {
    expect(yoyGrowth(null, 100)).toBeNull();
    expect(yoyGrowth(120, null)).toBeNull();
  });
});

describe("cagr", () => {
  it("computes a 3y CAGR", () => {
    expect(cagr(133.1, 100, 3)).toBeCloseTo(0.1, 3);
  });
  it("returns null for non-positive endpoints", () => {
    expect(cagr(-5, 100, 3)).toBeNull();
    expect(cagr(100, 0, 3)).toBeNull();
  });
});

describe("classifyCompany", () => {
  it("classifies from industry before sector", () => {
    expect(classifyCompany("Financial Services", "Banks - Diversified")).toBe("BANK");
    expect(classifyCompany("Technology", "Semiconductors")).toBe("SEMICONDUCTOR");
    expect(classifyCompany("Real Estate", "REIT - Specialty")).toBe("REIT");
  });
  it("falls back to GENERAL", () => {
    expect(classifyCompany(null, null)).toBe("GENERAL");
  });
});
