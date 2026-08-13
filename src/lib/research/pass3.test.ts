import { describe, expect, it } from "vitest";
import { categorise } from "@/lib/providers/greenhouse";
import { matches } from "@/lib/providers/polymarket";
import { dedupe, summarise, withLag, MIN_SAMPLE } from "./congress";
import type { CongressTrade } from "./alt-data";

describe("job categorisation", () => {
  it("routes an AI-infrastructure role to AI rather than generic engineering", () => {
    expect(categorise("Machine Learning Engineer", "Engineering", "NYC")).toBe("AI/ML");
    expect(categorise("Senior LLM Research Scientist", "Research", "SF")).toBe("AI/ML");
    // Plain engineering must not be swept into AI.
    expect(categorise("Backend Engineer", "Engineering", "NYC")).toBe("Software/Engineering");
  });

  it("separates hardware from software", () => {
    expect(categorise("ASIC Design Engineer", "Silicon", "Austin, TX")).toBe(
      "Hardware/Semiconductor",
    );
  });

  it("classifies by function first and location only as a fallback", () => {
    // A sales role abroad is still a sales role.
    expect(categorise("Account Executive", "Sales", "Berlin, Germany")).toBe("Sales");
    // With no functional signal, a non-US location is what is left to say.
    expect(categorise("Office Coordinator", "", "Tokyo, Japan")).toBe("International");
    expect(categorise("Office Coordinator", "", "Austin, TX")).toBe("Other");
  });
});

describe("polymarket matching", () => {
  const fomc = { allOf: ["fed", "rate"], noneOf: ["ecb"], resolvesNear: "2026-09-16", windowDays: 21 };

  it("accepts a market resolving near the meeting", () => {
    expect(matches("Will the Fed cut rates in September?", fomc, "2026-09-18")).toBe(true);
  });

  it("rejects the same wording for a different meeting", () => {
    // Identical question, three months later. Only the date separates them.
    expect(matches("Will the Fed cut rates in December?", fomc, "2026-12-16")).toBe(false);
  });

  it("rejects a market with no end date rather than assuming it fits", () => {
    expect(matches("Will the Fed cut rates?", fomc, null)).toBe(false);
  });
});

describe("congress disclosures", () => {
  const t = (o: Partial<CongressTrade>): CongressTrade => ({
    politician: "Doe, Jane",
    chamber: "House",
    ticker: "NVDA",
    side: "BUY",
    transactionDate: "2026-06-01",
    disclosureDate: "2026-07-10",
    valueLow: 15000,
    valueHigh: 50000,
    ...o,
  });

  it("computes the disclosure lag, which is the point of the data", () => {
    expect(withLag(t({})).disclosureLagDays).toBe(39);
  });

  it("returns null lag rather than zero when a date is unusable", () => {
    expect(withLag(t({ disclosureDate: "" })).disclosureLagDays).toBeNull();
  });

  it("drops the same filing arriving from two mirrors", () => {
    const rows = [withLag(t({})), withLag(t({})), withLag(t({ ticker: "AAPL" }))];
    expect(dedupe(rows)).toHaveLength(2);
  });

  it("keeps two genuinely different trades by the same member", () => {
    const rows = [
      withLag(t({ transactionDate: "2026-06-01" })),
      withLag(t({ transactionDate: "2026-06-02" })),
    ];
    expect(dedupe(rows)).toHaveLength(2);
  });

  it("summarises a window without counting trades outside it", () => {
    const recent = withLag(t({ transactionDate: new Date().toISOString().slice(0, 10) }));
    const old = withLag(t({ transactionDate: "2020-01-01", ticker: "MSFT" }));
    const s = summarise([recent, old], 30, "30D");
    expect(s.buys).toBe(1);
    expect(s.topBought[0].ticker).toBe("NVDA");
  });

  it("sets a floor on the sample before any performance claim", () => {
    expect(MIN_SAMPLE).toBeGreaterThanOrEqual(5);
  });
});
