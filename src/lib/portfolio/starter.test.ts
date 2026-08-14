import { describe, expect, it } from "vitest";
import { buildSamplePortfolio, isSamplePortfolio, SAMPLE_SOURCE } from "./starter";
import { isPaperPortfolio, portfolioFromPaper } from "./from-paper";
import type { Trade, VirtualPortfolio } from "@/lib/server/virtual-portfolios";

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

describe("paper ledger becomes the portfolio", () => {
  const trade = (o: Partial<Trade> & { ticker: string; quantity: number; price: number }): Trade => ({
    id: o.ticker + o.quantity,
    side: "BUY",
    fees: 0,
    currency: "USD",
    date: "2026-01-01",
    note: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...o,
  });

  const book = (trades: Trade[], cash = 0): VirtualPortfolio => ({
    id: "b1",
    name: "My book",
    currency: "USD",
    cash,
    initialCash: 10_000,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    trades,
  });

  it("nets buys and sells into a holding", () => {
    const p = portfolioFromPaper(
      book([
        trade({ ticker: "AAPL", quantity: 10, price: 100 }),
        trade({ ticker: "AAPL", quantity: 4, price: 150, side: "SELL", date: "2026-01-05" }),
      ]),
    );
    const aapl = p?.positions.find((x) => x.code === "AAPL");
    // Six shares left at the running average of 100.
    expect(aapl?.amount).toBe(600);
  });

  it("drops a fully closed position", () => {
    const p = portfolioFromPaper(
      book([
        trade({ ticker: "AAPL", quantity: 5, price: 100 }),
        trade({ ticker: "AAPL", quantity: 5, price: 120, side: "SELL", date: "2026-01-05" }),
        trade({ ticker: "MSFT", quantity: 2, price: 300, date: "2026-01-02" }),
      ]),
    );
    expect(p?.positions.map((x) => x.code)).toEqual(["MSFT"]);
  });

  it("counts uninvested cash as a position", () => {
    const p = portfolioFromPaper(book([trade({ ticker: "AAPL", quantity: 10, price: 100 })], 1_000));
    const cash = p?.positions.find((x) => x.code === "CASH");
    expect(cash?.amount).toBe(1_000);
    expect(p?.positions.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1, 6);
  });

  it("is flagged as paper, not as a sample", () => {
    const p = portfolioFromPaper(book([trade({ ticker: "AAPL", quantity: 1, price: 100 })]))!;
    expect(isPaperPortfolio(p)).toBe(true);
    expect(isSamplePortfolio(p)).toBe(false);
    expect(p.meta.warnings.join(" ")).toMatch(/simulated/i);
  });

  it("returns null for an empty ledger so the sample can take over", () => {
    expect(portfolioFromPaper(book([]))).toBeNull();
  });

  it("leaves return and volatility absent rather than inventing them", () => {
    const p = portfolioFromPaper(book([trade({ ticker: "AAPL", quantity: 1, price: 100 })]))!;
    for (const x of p.positions) {
      expect(x.expectedReturn).toBe(0);
      expect(x.volatility).toBe(0);
    }
  });
});
