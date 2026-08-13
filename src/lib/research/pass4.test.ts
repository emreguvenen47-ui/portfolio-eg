import { describe, expect, it } from "vitest";
import { foldTurkish, searchUniverse, type BistListingRow } from "@/lib/providers/bist-universe";
import { compactMoney, fmtValue } from "@/components/research/primitives";
import { currencySymbol } from "@/lib/format-currency";

const row = (ticker: string, companyName: string): BistListingRow => ({
  ticker,
  companyName,
  exchange: "BIST",
  currency: "TRY",
  instrumentType: "Common Stock",
  isActive: true,
});

const UNIVERSE = [
  row("THYAO", "Türk Hava Yolları A.O."),
  row("TUPRS", "Tüpraş Türkiye Petrol Rafinerileri A.Ş."),
  row("ISCTR", "Türkiye İş Bankası A.Ş. C"),
  row("SISE", "Türkiye Şişe ve Cam Fabrikaları A.Ş."),
  row("HEKTS", "Hektaş Ticaret T.A.Ş."),
  row("ASUZU", "Anadolu Isuzu Otomotiv Sanayi"),
];

describe("Turkish text folding", () => {
  it("folds the dotted and dotless I in both directions", () => {
    // A naive toUpperCase in a Turkish locale maps i -> İ and breaks matching.
    expect(foldTurkish("İş Bankası")).toBe("IS BANKASI");
    expect(foldTurkish("Isuzu")).toBe("ISUZU");
  });

  it("folds the remaining Turkish diacritics", () => {
    expect(foldTurkish("Tüpraş")).toBe("TUPRAS");
    expect(foldTurkish("Şişecam")).toBe("SISECAM");
    expect(foldTurkish("Hektaş Ticaret")).toBe("HEKTAS TICARET");
  });
});

describe("BIST universe search", () => {
  it("finds a company by its diacritic-free name", () => {
    expect(searchUniverse(UNIVERSE, "TUPRAS").map((r) => r.ticker)).toContain("TUPRS");
    // The registered name is "Şişe ve Cam", not "Şişecam", so the folded
    // fragment is what matches — the curated list carries the trade name.
    expect(searchUniverse(UNIVERSE, "sise ve cam").map((r) => r.ticker)).toContain("SISE");
    expect(searchUniverse(UNIVERSE, "is bankasi").map((r) => r.ticker)).toContain("ISCTR");
  });

  it("ranks an exact ticker above a name that merely contains the term", () => {
    // "TURK" appears in several names; an exact ticker must still lead.
    expect(searchUniverse(UNIVERSE, "THYAO")[0].ticker).toBe("THYAO");
  });

  it("ranks a ticker prefix above a name match", () => {
    const hits = searchUniverse(UNIVERSE, "TU");
    expect(hits[0].ticker).toBe("TUPRS");
  });

  it("returns nothing for an empty query rather than the whole exchange", () => {
    expect(searchUniverse(UNIVERSE, "   ")).toEqual([]);
  });
});

describe("reporting currency", () => {
  it("never stamps a dollar sign on a lira figure", () => {
    // Turkish Airlines files in lira; ₺1.16tn rendered as $1.16T is wrong by
    // roughly forty times and wrong about the unit.
    expect(compactMoney(1_160_000_000_000, currencySymbol("TRY"))).toBe("₺1.16T");
    expect(compactMoney(1_160_000_000_000, currencySymbol("USD"))).toBe("$1.16T");
  });

  it("passes the symbol through the shared value formatter", () => {
    expect(fmtValue(2.5e9, "usd", currencySymbol("TRY"))).toBe("₺2.50B");
    // Non-money formats are unaffected by currency.
    expect(fmtValue(12.5, "pct", currencySymbol("TRY"))).toBe("12.5%");
  });

  it("falls back to the code itself for an unmapped currency", () => {
    expect(compactMoney(5e6, currencySymbol("JPY"))).toBe("JPY 5.0M");
  });

  it("reports missing money as N/A rather than zero", () => {
    expect(compactMoney(null)).toBe("N/A");
    expect(compactMoney(undefined)).toBe("N/A");
  });
});
