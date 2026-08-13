import { describe, expect, it } from "vitest";
import { buildPortfolio, normaliseWeights, type AiPosition } from "./portfolio-model";

const pos = (ticker: string, weight: number, extra: Partial<AiPosition> = {}): AiPosition => ({
  ticker,
  name: ticker,
  weight,
  assetClass: "Equity",
  region: "US",
  role: "CORE",
  reason: "test",
  ...extra,
});

/** Sum of the weights as the UI displays them, to one decimal place. */
const displayedTotal = (ws: number[]) =>
  Number(ws.reduce((s, w) => s + Number((w * 100).toFixed(1)), 0).toFixed(1));

describe("normaliseWeights", () => {
  it("leaves a clean percentage split alone", () => {
    const { positions, originalTotal } = normaliseWeights([
      pos("A", 60),
      pos("B", 40),
    ]);
    expect(positions.map((p) => p.weight)).toEqual([0.6, 0.4]);
    expect(originalTotal).toBeNull();
  });

  it("accepts fractions that already sum to 1", () => {
    const { positions, originalTotal } = normaliseWeights([pos("A", 0.25), pos("B", 0.75)]);
    expect(positions.map((p) => p.weight)).toEqual([0.25, 0.75]);
    expect(originalTotal).toBeNull();
  });

  it("rescales weights that do not sum to 100 and reports the original", () => {
    const { positions, originalTotal } = normaliseWeights([
      pos("A", 50),
      pos("B", 30),
      pos("C", 12),
    ]);
    expect(originalTotal).toBe(92);
    expect(positions.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1, 10);
  });

  it("keeps the DISPLAYED percentages summing to exactly 100.0", () => {
    // Three-way splits are the classic case where naive rounding shows 99.9%.
    const { positions } = normaliseWeights([pos("A", 1), pos("B", 1), pos("C", 1)]);
    expect(displayedTotal(positions.map((p) => p.weight))).toBe(100);
  });

  it("keeps seven uneven positions summing to exactly 100.0 when displayed", () => {
    const { positions } = normaliseWeights(
      [17, 13, 11, 23, 7, 19, 3].map((w, i) => pos(`P${i}`, w)),
    );
    expect(displayedTotal(positions.map((p) => p.weight))).toBe(100);
  });

  it("throws rather than emitting a zero-weight portfolio", () => {
    expect(() => normaliseWeights([pos("A", 0), pos("B", 0)])).toThrow();
  });
});

describe("buildPortfolio", () => {
  const draft = [
    pos("QQQ", 30, { assetClass: "Equity", region: "US" }),
    pos("VGK", 20, { assetClass: "Equity", region: "Europe" }),
    pos("GLDM", 15, { assetClass: "Commodity", region: "Global", role: "HEDGE" }),
    pos("SGOV", 25, { assetClass: "Cash", region: "US", role: "LIQUIDITY" }),
    pos("BIST", 10, { assetClass: "Equity", region: "Turkey", role: "DIVERSIFIER" }),
  ];

  it("allocates dollars in proportion to weight and conserves the total", () => {
    const built = buildPortfolio(draft, 250_000, "USD");
    const allocated = built.positions.reduce((s, p) => s + p.dollars, 0);
    expect(allocated).toBeCloseTo(250_000, 6);
    expect(built.positions.find((p) => p.ticker === "QQQ")!.dollars).toBeCloseTo(75_000, 6);
  });

  it("computes exposures from asset class and region", () => {
    const { exposures } = buildPortfolio(draft, 100_000, "USD");
    expect(exposures.equity).toBeCloseTo(0.6, 10);
    expect(exposures.cash).toBeCloseTo(0.25, 10);
    expect(exposures.commodity).toBeCloseTo(0.15, 10);
    expect(exposures.turkey).toBeCloseTo(0.1, 10);
    expect(exposures.technology).toBeCloseTo(0.3, 10); // QQQ only
  });

  it("only runs the Turkey scenario when Turkey exposure exists", () => {
    const withTurkey = buildPortfolio(draft, 100_000, "USD");
    expect(withTurkey.scenarios.map((s) => s.id)).toContain("turkey-crisis");

    const withoutTurkey = buildPortfolio(
      draft.filter((p) => p.region !== "Turkey"),
      100_000,
      "USD",
    );
    expect(withoutTurkey.scenarios.map((s) => s.id)).not.toContain("turkey-crisis");
  });

  it("prefers the most specific shock: ticker over region over asset class", () => {
    // SMH carries an explicit −38% in the AI-correction scenario; a plain US
    // equity with no ticker rule falls through to the −10% class shock.
    const semis = buildPortfolio([pos("SMH", 100)], 100_000, "USD");
    const generic = buildPortfolio([pos("ZZZZ", 100)], 100_000, "USD");
    const semisHit = semis.scenarios.find((s) => s.id === "ai-correction")!;
    const genericHit = generic.scenarios.find((s) => s.id === "ai-correction")!;
    expect(semisHit.impactPct).toBeCloseTo(-38, 6);
    expect(genericHit.impactPct).toBeCloseTo(-10, 6);
  });

  it("shows cash defending in an equity crash", () => {
    const allCash = buildPortfolio(
      [pos("SGOV", 100, { assetClass: "Cash", role: "LIQUIDITY" })],
      100_000,
      "USD",
    );
    const crash = allCash.scenarios.find((s) => s.id === "us-crash")!;
    // Region shocks are equity-market shocks, so a US-domiciled T-bill fund
    // must NOT inherit the −30% US equity move.
    expect(crash.impactPct).toBeGreaterThan(-1);
  });

  it("still applies region shocks to equities in the same region", () => {
    const usEquity = buildPortfolio([pos("VTI", 100, { region: "US" })], 100_000, "USD");
    const crash = usEquity.scenarios.find((s) => s.id === "us-crash")!;
    expect(crash.impactPct).toBeCloseTo(-30, 6);
  });

  it("scores a diversified book above a single-position one", () => {
    const diversified = buildPortfolio(draft, 100_000, "USD");
    const concentrated = buildPortfolio([pos("QQQ", 100)], 100_000, "USD");
    expect(diversified.score.total).toBeGreaterThan(concentrated.score.total);
    expect(concentrated.score.concentration).toBe(0);
  });

  it("keeps every sub-score inside 0..100", () => {
    for (const built of [
      buildPortfolio(draft, 100_000, "USD"),
      buildPortfolio([pos("QQQ", 100)], 100_000, "USD"),
    ]) {
      for (const [, v] of Object.entries(built.score)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});
