import { describe, expect, it } from "vitest";
import { defaultVolatilityFor, snapshot, type WhatIfPosition } from "./what-if";
import { buildXray } from "./xray";
import { relativeStrength, returnOver } from "./relative-strength";
import { scanSymbol } from "./scanner";
import type { Candle, PositionValuation, Position } from "@/lib/types";

const pos = (o: Partial<WhatIfPosition>): WhatIfPosition => ({
  code: "X",
  name: "X",
  weight: 0.1,
  assetClass: "Equity",
  region: "US",
  volatility: 0.18,
  currency: "USD",
  theme: "Core",
  source: "current",
  ...o,
});

describe("what-if snapshot", () => {
  it("does not apply an equity region shock to a cash sleeve", () => {
    // A T-bill fund tagged "US" is still cash. Applying the US equity shock by
    // region alone made the cash line fall 30% in a crash scenario.
    const s = snapshot([
      pos({ code: "SPY", weight: 0.5 }),
      pos({ code: "SGOV", weight: 0.5, assetClass: "Cash", volatility: 0.005 }),
    ]);
    const crash = s.stress.find((x) => x.id === "us-crash")!;
    // Equity half takes −30%, cash half takes its class shock of +0.2%.
    expect(crash.impactPct).toBeCloseTo(0.5 * -30 + 0.5 * 0.2, 6);
  });

  it("prices a Turkey crisis only through Turkish equity", () => {
    const s = snapshot([
      pos({ code: "XU100", region: "Turkey", weight: 0.3 }),
      pos({ code: "SPY", region: "US", weight: 0.7 }),
    ]);
    const tr = s.stress.find((x) => x.id === "turkey")!;
    expect(tr.impactPct).toBeCloseTo(0.3 * -35, 6);
  });

  it("reports concentration through the effective position count", () => {
    const even = snapshot([
      pos({ code: "A", weight: 0.25 }),
      pos({ code: "B", weight: 0.25 }),
      pos({ code: "C", weight: 0.25 }),
      pos({ code: "D", weight: 0.25 }),
    ]);
    const lopsided = snapshot([
      pos({ code: "A", weight: 0.85 }),
      pos({ code: "B", weight: 0.05 }),
      pos({ code: "C", weight: 0.05 }),
      pos({ code: "D", weight: 0.05 }),
    ]);
    expect(even.effectivePositions).toBeCloseTo(4, 6);
    expect(lopsided.effectivePositions).toBeLessThan(2);
    expect(lopsided.largestWeight).toBeCloseTo(0.85, 6);
  });

  it("keeps diversification below the weighted average volatility", () => {
    // Two imperfectly-correlated sleeves must not sum their risk linearly.
    const s = snapshot([
      pos({ code: "SPY", weight: 0.5, volatility: 0.18 }),
      pos({ code: "GLDM", weight: 0.5, assetClass: "Commodity", volatility: 0.18 }),
    ]);
    expect(s.volatility).toBeGreaterThan(0);
    expect(s.volatility).toBeLessThan(0.18);
  });

  it("gives a hand-added sleeve a class-appropriate volatility", () => {
    expect(defaultVolatilityFor("Cash")).toBeLessThan(defaultVolatilityFor("Equity"));
    expect(defaultVolatilityFor("Commodity")).toBeGreaterThan(defaultVolatilityFor("Alternative"));
  });
});

const valuation = (o: {
  code: string;
  weight: number;
  assetClass?: Position["assetClass"];
  region?: Position["region"];
  currencyCode?: Position["currencyCode"];
  category?: string;
  themes?: string[];
}): PositionValuation =>
  ({
    currentWeight: o.weight,
    position: {
      code: o.code,
      category: o.category ?? "Core",
      assetClass: o.assetClass ?? "Equity",
      region: o.region ?? "US",
      currencyCode: o.currencyCode ?? "USD",
      themes: o.themes ?? [],
    },
  }) as unknown as PositionValuation;

describe("portfolio x-ray", () => {
  it("credits a sleeve to every theme it carries", () => {
    const x = buildXray([
      valuation({ code: "SMH", weight: 0.4, themes: ["AI", "Semiconductors"] }),
      valuation({ code: "SPY", weight: 0.6, themes: ["Core"] }),
    ]);
    const byLabel = Object.fromEntries(x.byTheme.map((t) => [t.label, t.total]));
    expect(byLabel.AI).toBeCloseTo(0.4, 6);
    expect(byLabel.Semiconductors).toBeCloseTo(0.4, 6);
    expect(byLabel.Core).toBeCloseTo(0.6, 6);
  });

  it("labels an untagged sleeve rather than dropping it", () => {
    const x = buildXray([valuation({ code: "PPF", weight: 1, themes: [] })]);
    expect(x.byTheme).toEqual([{ label: "Untagged", direct: 1, indirect: 0, total: 1 }]);
  });

  it("reports zero look-through and says so", () => {
    const x = buildXray([valuation({ code: "QQQ", weight: 1, themes: ["AI"] })]);
    expect(x.hasLookThrough).toBe(false);
    // Nothing may claim indirect exposure while no holdings source is wired up.
    expect(x.byAssetClass.every((b) => b.indirect === 0)).toBe(true);
  });

  it("sums single-value dimensions to the invested weight", () => {
    const rows = [
      valuation({ code: "A", weight: 0.3, region: "US" }),
      valuation({ code: "B", weight: 0.2, region: "Europe" }),
      valuation({ code: "C", weight: 0.5, region: "Turkey" }),
    ];
    const x = buildXray(rows);
    const total = x.byRegion.reduce((s, b) => s + b.total, 0);
    expect(total).toBeCloseTo(1, 9);
  });
});

const series = (n: number, from: number, to: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const close = from * (to / from) ** (i / (n - 1));
    const d = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
    return { date: d, open: close, high: close, low: close, close, volume: 1_000 };
  });

describe("relative strength", () => {
  it("returns null for a window the series cannot cover", () => {
    // Twenty bars cannot answer a one-year question. Truncating the window
    // silently would compare a month against a year.
    expect(returnOver(series(20, 100, 110), 252)).toBeNull();
  });

  it("calls a leader outperforming across every covered window", () => {
    const rs = relativeStrength(series(300, 100, 200), series(300, 100, 110), "SPY");
    expect(rs.verdict).toBe("OUTPERFORMING");
    expect(rs.rows.every((r) => r.relative === null || r.relative > 0)).toBe(true);
  });

  it("reports N/A rather than a verdict when the benchmark has no data", () => {
    const rs = relativeStrength(series(300, 100, 200), [], "SPY");
    expect(rs.verdict).toBe("N/A");
    expect(rs.rows.every((r) => r.relative === null)).toBe(true);
  });

  it("measures both legs from the same bar index", () => {
    // Identical series must net to exactly zero excess in every window — any
    // offset in how the two legs are indexed would show up here.
    const rs = relativeStrength(series(300, 100, 180), series(300, 100, 180), "SPY");
    for (const r of rs.rows) {
      if (r.relative !== null) expect(Math.abs(r.relative)).toBeLessThan(1e-9);
    }
  });
});

describe("opportunity scanner", () => {
  it("drops components with no data instead of scoring them zero", () => {
    // A symbol with candles but no fundamentals must not be punished for the
    // missing metrics — it should simply report lower coverage.
    const withHistory = scanSymbol("A", series(300, 100, 120), undefined, null, []);
    expect(withHistory.coverage).toBeGreaterThan(0);
    expect(withHistory.coverage).toBeLessThan(8);
    // Only price-derived components may appear; the fundamental ones are absent
    // rather than present with a zero.
    const keys = withHistory.components.map((c) => c.key);
    expect(keys).not.toContain("quality");
    expect(keys).not.toContain("valuation");
    expect(keys).not.toContain("analyst");
  });

  it("scores nothing and stays neutral with no inputs at all", () => {
    const bare = scanSymbol("B", [], undefined, null, []);
    expect(bare.score).toBeNull();
    expect(bare.coverage).toBe(0);
    expect(bare.verdict).toBe("NEUTRAL");
  });

  it("rates a name at its 52-week high below one that has pulled back", () => {
    const atHigh = scanSymbol("H", series(300, 100, 200), undefined, null, []);
    const pulledBack = scanSymbol(
      "P",
      [...series(200, 100, 200), ...series(100, 200, 150)],
      undefined,
      null,
      [],
    );
    const grade = (r: typeof atHigh) =>
      r.components.find((c) => c.key === "fromHigh")!.score;
    expect(grade(pulledBack)).toBeGreaterThan(grade(atHigh));
  });
});
