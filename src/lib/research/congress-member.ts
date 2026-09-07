import "server-only";
import { getAllCongressRows } from "./congress-archive";
import { getMemberPerformance, type MemberPerf } from "./congress-perf";
import { withLag, type CongressRow } from "./congress";
import type { CongressTrade } from "./alt-data";

/**
 * MEMBER PROFILE — one politician's full disclosure history, "what office
 * they hold" stated plainly, and a deterministic read of what they likely
 * still hold: the LAST filed action per ticker (a later SELL after a BUY
 * means likely exited; a BUY with nothing after it means likely still held).
 * This is a disclosure trail, not a verified portfolio — every row says so.
 */

export interface HoldingEstimate {
  ticker: string;
  company: string | null;
  lastAction: "BUY" | "SELL";
  lastActionDate: string;
  totalBuys: number;
  totalSells: number;
  status: "LIKELY HELD" | "LIKELY EXITED";
  sourceUrl: string | null;
}

export interface MemberProfile {
  politician: string;
  chamber: "House" | "Senate";
  state: string | null;
  office: string; // "Senator for California" / "Representative for NJ"
  rows: CongressRow[]; // full history, newest first
  perf: MemberPerf | null;
  holdings: HoldingEstimate[]; // newest-active first
  firstFiling: string | null;
  lastFiling: string | null;
}

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

function officeOf(chamber: string, state: string | null): string {
  const stateName = state ? (STATE_NAMES[state] ?? state) : null;
  if (chamber === "Senate") return stateName ? `U.S. Senator for ${stateName}` : "U.S. Senator";
  return stateName ? `U.S. Representative for ${stateName}` : "U.S. Representative";
}

export async function getMemberProfile(politicianExact: string): Promise<MemberProfile | null> {
  const all = await getAllCongressRows();
  const target = politicianExact.trim().toLowerCase();
  const mine: CongressTrade[] = all.filter((r) => r.politician.trim().toLowerCase() === target);
  if (mine.length === 0) return null;

  const rows = mine.map(withLag).sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
  const chamber = (rows[0]!.chamber as "House" | "Senate") ?? "House";
  const state = rows.find((r) => r.state)?.state ?? null;

  // Deterministic holdings estimate: last filed action per ticker.
  const byTicker = new Map<string, CongressRow[]>();
  for (const r of rows) {
    const g = byTicker.get(r.ticker) ?? [];
    g.push(r);
    byTicker.set(r.ticker, g);
  }
  const holdings: HoldingEstimate[] = [...byTicker.entries()]
    .map(([ticker, txs]) => {
      const sorted = [...txs].sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
      const last = sorted[sorted.length - 1]!;
      return {
        ticker,
        company: txs.find((t) => t.company)?.company ?? null,
        lastAction: last.side,
        lastActionDate: last.transactionDate,
        totalBuys: txs.filter((t) => t.side === "BUY").length,
        totalSells: txs.filter((t) => t.side === "SELL").length,
        status: (last.side === "BUY" ? "LIKELY HELD" : "LIKELY EXITED") as HoldingEstimate["status"],
        sourceUrl: last.sourceUrl ?? null,
      };
    })
    .sort((a, b) => b.lastActionDate.localeCompare(a.lastActionDate));

  // Reuse the deep performance ranking (already computed against the full ledger).
  const perfResult = getMemberPerformance(all);
  const perf = perfResult.members.find((m) => m.politician.trim().toLowerCase() === target) ?? null;

  return {
    politician: rows[0]!.politician,
    chamber,
    state,
    office: officeOf(chamber, state),
    rows,
    perf,
    holdings,
    firstFiling: rows.at(-1)?.transactionDate ?? null,
    lastFiling: rows[0]?.transactionDate ?? null,
  };
}
