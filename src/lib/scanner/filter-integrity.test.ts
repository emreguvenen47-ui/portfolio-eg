import { describe, expect, it } from "vitest";
import { classifyMarketCap, classifySector, CAP_BUCKET_LABEL } from "./classify";
import { eligible, type PoolFilters } from "./engine";
import type { UniverseRow } from "./screener-universe";
import { PRESETS, EMPTY_FILTERS, applyPreset, presetOverrides } from "./filters";

const B = 1_000_000_000;
const M = 1_000_000;

const row = (o: Partial<UniverseRow> & { symbol: string; marketCap: number | null }): UniverseRow => ({
  name: o.symbol,
  region: "US",
  currency: "USD",
  bucket: classifyMarketCap(o.marketCap, "USD", "US"),
  sector: "Industrials",
  industry: "Machinery",
  price: 50,
  volume: 1_000_000,
  dollarVolume: 50_000_000,
  ...o,
});

const pool = (over: Partial<PoolFilters> = {}): PoolFilters => ({
  regions: ["US"],
  sectors: [],
  industries: [],
  buckets: [],
  minMarketCap: null,
  maxMarketCap: null,
  minDollarVolume: null,
  minPrice: null,
  ...over,
});

describe("classifyMarketCap boundaries", () => {
  it("places every stated boundary on the correct side", () => {
    const cases: [number, string][] = [
      [299 * M, "MICRO"],
      [300 * M, "SMALL"],
      [1.99 * B, "SMALL"],
      [2 * B, "MID"],
      [9.99 * B, "MID"],
      [10 * B, "LARGE"],
      [199.9 * B, "LARGE"],
      [200 * B, "MEGA"],
    ];
    for (const [cap, expected] of cases) {
      expect(classifyMarketCap(cap, "USD", "US"), `${cap}`).toBe(expected);
    }
  });

  it("returns SIZE UNKNOWN rather than guessing", () => {
    expect(classifyMarketCap(null, "USD", "US")).toBeNull();
    expect(classifyMarketCap(undefined, "USD", "US")).toBeNull();
    expect(classifyMarketCap(0, "USD", "US")).toBeNull();
    expect(classifyMarketCap(Number.NaN, "USD", "US")).toBeNull();
    expect(classifyMarketCap(-5, "USD", "US")).toBeNull();
  });

  it("uses the lira ladder for BIST, not a converted dollar one", () => {
    // ₺30bn is a mid cap in Istanbul; the same number of dollars is a large cap.
    expect(classifyMarketCap(30 * B, "TRY", "BIST")).toBe("MID");
    expect(classifyMarketCap(30 * B, "USD", "US")).toBe("LARGE");
    expect(CAP_BUCKET_LABEL.BIST.SMALL).toContain("₺");
  });
});

describe("sector classification", () => {
  it("prefers the granular industry over the coarse sector", () => {
    // Nasdaq files chipmakers under "Technology"; the model needs the narrower
    // read because it decides which metrics are even used.
    expect(classifySector("Semiconductors", "Technology")).toBe("Semiconductors");
    expect(classifySector("Major Banks", "Finance")).toBe("Banks");
    expect(classifySector("Computer Software: Prepackaged Software", "Technology")).toBe("Software");
  });
});

// ------------------------------------------------------------- the actual bug

describe("hard filters are hard", () => {
  /**
   * The reported failure: a small-cap request returned mega caps because the
   * scanner scored a pre-warmed set and filtered afterwards, and the warm set
   * was mega-cap heavy. This is the universe that reproduces it.
   */
  const universe: UniverseRow[] = [
    row({ symbol: "AAPL", marketCap: 3_500 * B, sector: "Technology", industry: "Computer Manufacturing" }),
    row({ symbol: "MSFT", marketCap: 3_100 * B, sector: "Technology", industry: "Computer Software: Prepackaged Software" }),
    row({ symbol: "NVDA", marketCap: 4_000 * B, sector: "Semiconductors", industry: "Semiconductors" }),
    row({ symbol: "CAT", marketCap: 180 * B, sector: "Industrials", industry: "Machinery" }),
    row({ symbol: "MIDIND", marketCap: 5 * B, sector: "Industrials", industry: "Machinery" }),
    row({ symbol: "SMLIND", marketCap: 900 * M, sector: "Industrials", industry: "Machinery" }),
    row({ symbol: "SMLIND2", marketCap: 1.4 * B, sector: "Industrials", industry: "Metal Fabrications" }),
    row({ symbol: "SMLTECH", marketCap: 1.1 * B, sector: "Technology", industry: "Computer Software: Prepackaged Software" }),
    row({ symbol: "MIDTECH", marketCap: 4 * B, sector: "Technology", industry: "Computer Software: Prepackaged Software" }),
    row({ symbol: "SMLHLTH", marketCap: 600 * M, sector: "Healthcare", industry: "Biotechnology" }),
    row({ symbol: "MICRO1", marketCap: 120 * M, sector: "Industrials", industry: "Machinery" }),
    row({ symbol: "NOCAP", marketCap: null, sector: "Industrials", industry: "Machinery" }),
    row({ symbol: "BISTX", marketCap: null, region: "BIST", currency: "TRY", sector: "Other", industry: null }),
  ];

  const symbols = (f: PoolFilters) => eligible(universe, f).map((r) => r.symbol).sort();

  it("A — SMALL only returns $300m to $2bn", () => {
    const out = eligible(universe, pool({ buckets: ["SMALL"] }));
    expect(out.length).toBeGreaterThan(0);
    for (const r of out) {
      expect(r.marketCap).not.toBeNull();
      expect(r.marketCap!).toBeGreaterThanOrEqual(300 * M);
      expect(r.marketCap!).toBeLessThan(2 * B);
    }
    // The specific regression: no mega cap may survive a small-cap filter.
    expect(out.map((r) => r.symbol)).not.toContain("AAPL");
    expect(out.map((r) => r.symbol)).not.toContain("NVDA");
  });

  it("B — MID only returns $2bn to $10bn", () => {
    const out = eligible(universe, pool({ buckets: ["MID"] }));
    expect(out.length).toBeGreaterThan(0);
    for (const r of out) {
      expect(r.marketCap!).toBeGreaterThanOrEqual(2 * B);
      expect(r.marketCap!).toBeLessThan(10 * B);
    }
  });

  it("C — SMALL + Industrials satisfies both, not either", () => {
    expect(symbols(pool({ buckets: ["SMALL"], sectors: ["Industrials"] }))).toEqual([
      "SMLIND",
      "SMLIND2",
    ]);
  });

  it("D — MID + Technology satisfies both", () => {
    expect(symbols(pool({ buckets: ["MID"], sectors: ["Technology"] }))).toEqual(["MIDTECH"]);
  });

  it("E — SMALL + Healthcare satisfies both", () => {
    expect(symbols(pool({ buckets: ["SMALL"], sectors: ["Healthcare"] }))).toEqual(["SMLHLTH"]);
  });

  it("F — MEGA only returns $200bn and above", () => {
    const out = eligible(universe, pool({ buckets: ["MEGA"] }));
    for (const r of out) expect(r.marketCap!).toBeGreaterThanOrEqual(200 * B);
    expect(out.map((r) => r.symbol).sort()).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  it("G — an impossible combination returns nothing, never a substitute", () => {
    const out = eligible(universe, pool({ buckets: ["MEGA"], sectors: ["Healthcare"] }));
    expect(out).toEqual([]);
  });

  it("excludes SIZE UNKNOWN from every size filter", () => {
    for (const b of ["MICRO", "SMALL", "MID", "LARGE", "MEGA"] as const) {
      const out = symbols(pool({ buckets: [b] }));
      expect(out).not.toContain("NOCAP");
      expect(out).not.toContain("BISTX");
    }
    // But it is still reachable when no size filter is active.
    expect(symbols(pool({}))).toContain("NOCAP");
  });

  it("applies an explicit market-cap range as AND, not OR", () => {
    const out = eligible(universe, pool({ minMarketCap: 1 * B, maxMarketCap: 6 * B }));
    for (const r of out) {
      expect(r.marketCap!).toBeGreaterThanOrEqual(1 * B);
      expect(r.marketCap!).toBeLessThanOrEqual(6 * B);
    }
  });

  it("enforces the industry filter when one is chosen", () => {
    expect(symbols(pool({ buckets: ["SMALL"], industries: ["Metal Fabrications"] }))).toEqual([
      "SMLIND2",
    ]);
  });

  it("enforces the liquidity floor and excludes unknown volume", () => {
    const thin = row({ symbol: "THIN", marketCap: 1 * B, dollarVolume: 100_000 });
    const unknown = row({ symbol: "UNK", marketCap: 1 * B, dollarVolume: null });
    const out = eligible([...universe, thin, unknown], pool({ minDollarVolume: 1_000_000 }));
    expect(out.map((r) => r.symbol)).not.toContain("THIN");
    expect(out.map((r) => r.symbol)).not.toContain("UNK");
  });

  it("keeps regions separate", () => {
    expect(symbols(pool({ regions: ["BIST"] }))).toEqual(["BISTX"]);
  });
});

describe("presets", () => {
  it("BEST SMALL CAPS hard-constrains size", () => {
    const p = PRESETS.find((x) => x.id === "best-small")!;
    expect(applyPreset(EMPTY_FILTERS, p).buckets).toEqual(["SMALL"]);
    expect(presetOverrides(p)).toContain("buckets");
  });

  it("BEST MID CAPS hard-constrains size", () => {
    const p = PRESETS.find((x) => x.id === "best-mid")!;
    expect(applyPreset(EMPTY_FILTERS, p).buckets).toEqual(["MID"]);
  });

  it("a non-size preset preserves the size and sector the user chose", () => {
    const manual = { ...EMPTY_FILTERS, buckets: ["SMALL" as const], sectors: ["Healthcare" as const] };
    const cheap = PRESETS.find((x) => x.id === "cheap-quality")!;
    const out = applyPreset(manual, cheap);
    expect(out.buckets).toEqual(["SMALL"]);
    expect(out.sectors).toEqual(["Healthcare"]);
    // And it does not claim to override them.
    expect(presetOverrides(cheap)).not.toContain("buckets");
    expect(presetOverrides(cheap)).not.toContain("sectors");
  });

  it("every preset declares exactly the fields it replaces", () => {
    for (const p of PRESETS) {
      const declared = presetOverrides(p);
      for (const k of declared) {
        expect(p.filters[k]).toBeDefined();
      }
    }
  });
});
