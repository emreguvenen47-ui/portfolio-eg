import { describe, expect, it } from "vitest";
import { FLOW_GROUPS, TIMEFRAMES, groupById } from "./sectors";
import { rotationMap, type GroupRotation } from "./engine";

const cells = (rel: Record<string, number | null>) =>
  TIMEFRAMES.map((t) => ({
    timeframe: t.key,
    ret: rel[t.key] ?? null,
    benchmarkRet: 0,
    relative: rel[t.key] ?? null,
    direction: ((rel[t.key] ?? 0) > 0.5 ? "up" : (rel[t.key] ?? 0) < -0.5 ? "down" : "flat") as
      | "up"
      | "flat"
      | "down",
  }));

const g = (id: string, rel: Record<string, number | null>): GroupRotation => ({
  group: FLOW_GROUPS.find((x) => x.id === id) ?? FLOW_GROUPS[0],
  dataType: "MARKET_ROTATION_SIGNAL",
  cells: cells(rel),
  breadth: { sample: 20, above20: 60, above50: 55, above200: 50, advancing: 12, declining: 8 },
  members: [],
  score: 50,
  components: [],
  coverage: { have: 8, total: 8 },
  state: "NEUTRAL",
  why: ["x"],
  inflection: null,
  relVolume: 0,
});

describe("flow group definitions", () => {
  it("covers the eleven headline sectors", () => {
    const sectors = FLOW_GROUPS.filter((x) => x.kind === "sector");
    expect(sectors).toHaveLength(11);
    for (const s of sectors) expect(s.proxy).toMatch(/^[A-Z]+$/);
  });

  it("covers the named sub-sectors", () => {
    const ids = FLOW_GROUPS.filter((x) => x.kind === "subsector").map((x) => x.id);
    for (const id of ["semis", "software", "banks", "defense", "biotech", "homebuilders", "transport", "metals", "oilgas", "retail"]) {
      expect(ids).toContain(id);
    }
  });

  it("offers every required timeframe", () => {
    expect(TIMEFRAMES.map((t) => t.key)).toEqual(["1D", "1W", "1M", "3M", "6M", "1Y"]);
  });

  it("resolves a group by id", () => {
    expect(groupById("semis")?.proxy).toBe("SMH");
  });
});

describe("rotation map", () => {
  it("refuses to call narrow dispersion a rotation", () => {
    // Every sector within a point of the benchmark is ordinary noise, not
    // capital moving anywhere.
    const groups = FLOW_GROUPS.slice(0, 8).map((x, i) => g(x.id, { "1W": (i - 4) * 0.2 }));
    const m = rotationMap(groups, "1W");
    expect(m.supported).toBe(false);
    expect(m.note).toMatch(/too narrow|noise/i);
  });

  it("names the leaders and laggards when dispersion is real", () => {
    const spread = [8, 6, 4, 1, -1, -4, -6, -9];
    const groups = FLOW_GROUPS.slice(0, 8).map((x, i) => g(x.id, { "1W": spread[i] }));
    const m = rotationMap(groups, "1W");
    expect(m.supported).toBe(true);
    expect(m.into.length).toBeGreaterThan(0);
    expect(m.out.length).toBeGreaterThan(0);
    // Only genuinely negative groups may be listed as being rotated out of.
    for (const o of m.out) {
      const rel = o.cells.find((c) => c.timeframe === "1W")!.relative!;
      expect(rel).toBeLessThan(0);
    }
    for (const i of m.into) {
      const rel = i.cells.find((c) => c.timeframe === "1W")!.relative!;
      expect(rel).toBeGreaterThan(0);
    }
  });

  it("reports unsupported when too few sectors have a series", () => {
    const groups = FLOW_GROUPS.slice(0, 3).map((x) => g(x.id, { "1W": 5 }));
    expect(rotationMap(groups, "1W").supported).toBe(false);
  });

  it("ignores sectors with no relative reading for the window", () => {
    const groups = FLOW_GROUPS.slice(0, 8).map((x, i) =>
      g(x.id, { "1W": i < 3 ? null : (i - 5) * 3 }),
    );
    const m = rotationMap(groups, "1W");
    // Five usable series is below the floor of six.
    expect(m.supported).toBe(false);
  });
});

describe("data-type honesty", () => {
  it("never labels a market-derived reading as an actual fund flow", () => {
    const groups = FLOW_GROUPS.slice(0, 8).map((x) => g(x.id, { "1W": 2 }));
    for (const x of groups) expect(x.dataType).toBe("MARKET_ROTATION_SIGNAL");
  });
});
