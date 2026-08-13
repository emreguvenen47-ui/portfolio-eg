import { describe, expect, it } from "vitest";
import { buildSamplePortfolio, isSamplePortfolio, SAMPLE_SOURCE } from "./starter";

/**
 * The sample exists so a new account has something to look at. These tests
 * guard the property that makes that acceptable: it must be unmistakable.
 */

describe("sample portfolio", () => {
  const p = buildSamplePortfolio();

  it("is labelled as a sample in a way pages can detect", () => {
    expect(isSamplePortfolio(p)).toBe(true);
    expect(p.meta.sourceFile).toBe(SAMPLE_SOURCE);
    expect(p.meta.title.toLowerCase()).toContain("sample");
  });

  it("carries a warning saying the holdings are not the user's", () => {
    expect(p.meta.warnings.length).toBeGreaterThan(0);
    expect(p.meta.warnings.join(" ")).toMatch(/not yours/i);
  });

  it("does not flag an uploaded portfolio as a sample", () => {
    const real = {
      ...p,
      meta: { ...p.meta, sourceFile: "Portfoy_Tahsisi.xlsx", title: "My portfolio" },
    };
    expect(isSamplePortfolio(real)).toBe(false);
  });

  it("has weights that sum to one", () => {
    const total = p.positions.reduce((s, x) => s + x.weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("has amounts consistent with its weights and stated total", () => {
    const total = p.positions.reduce((s, x) => s + x.amount, 0);
    expect(Math.abs(total - p.meta.totalAmount)).toBeLessThanOrEqual(p.positions.length);
  });

  it("spans equity, commodity and cash so the breakdown panels are not empty", () => {
    const classes = new Set(p.positions.map((x) => x.assetClass));
    expect(classes.has("Equity")).toBe(true);
    expect(classes.has("Commodity")).toBe(true);
    expect(classes.has("Cash")).toBe(true);
  });

  it("gives every position a quotable symbol", () => {
    // A null symbol would render as N/A everywhere and defeat the purpose.
    for (const x of p.positions) {
      expect(x.symbol).toBeTruthy();
      expect(x.symbol).toMatch(/^[A-Z]+$/);
    }
  });

  it("uses real instruments rather than invented tickers", () => {
    const codes = p.positions.map((x) => x.code);
    for (const known of ["SPY", "QQQ", "AGG", "GLD"]) expect(codes).toContain(known);
  });
});
