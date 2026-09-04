import type { CompanySnapshot } from "../normalize/company";

/**
 * Data Integrity Engine (master spec §5).
 *
 * Grades every CompanySnapshot before it may enter valuation engines.
 * Deterministic: same snapshot, same grade. Downgrades never fabricate —
 * they only annotate. A snapshot graded INVALID must never produce a fair
 * value; the UI shows DATA INCOMPLETE instead.
 */

const DAY_MS = 86_400_000;

export function validateCompanySnapshot(s: CompanySnapshot): CompanySnapshot {
  const issues: string[] = [];
  let grade: "HIGH" | "MEDIUM" | "LOW" | "INVALID" = "HIGH";
  const downgrade = (to: "MEDIUM" | "LOW" | "INVALID", why: string) => {
    issues.push(why);
    const order = { HIGH: 3, MEDIUM: 2, LOW: 1, INVALID: 0 } as const;
    if (order[to] < order[grade]) grade = to;
  };

  // --- presence of the core spine -----------------------------------------
  if (s.quarterly.length === 0) downgrade("INVALID", "No quarterly statements");
  if (s.marketCap === null) downgrade("LOW", "Market cap missing");
  if (s.identity.currency === null) downgrade("MEDIUM", "Reporting currency missing");

  // --- staleness ------------------------------------------------------------
  const latest = s.quarterly[0];
  if (latest) {
    const ageDays = (Date.now() - Date.parse(latest.date)) / DAY_MS;
    if (Number.isFinite(ageDays) && ageDays > 200) {
      downgrade("MEDIUM", `Latest quarter is ${Math.round(ageDays)} days old`);
    }
    if (Number.isFinite(ageDays) && ageDays > 420) {
      downgrade("LOW", "Statements more than a year stale");
    }
  }

  // --- duplicate / mis-ordered quarters -------------------------------------
  const dates = s.quarterly.map((q) => q.date);
  if (new Set(dates).size !== dates.length) downgrade("LOW", "Duplicate quarterly periods");

  // --- TTM internal consistency ----------------------------------------------
  if (s.revenueTtm !== null && s.revenueTtm < 0) downgrade("INVALID", "Negative TTM revenue");
  if (
    s.revenueTtm !== null &&
    s.netIncomeTtm !== null &&
    s.revenueTtm > 0 &&
    Math.abs(s.netIncomeTtm) > s.revenueTtm * 3
  ) {
    downgrade("LOW", "Net income implausibly large vs revenue (unit mismatch?)");
  }

  // --- impossible margins -----------------------------------------------------
  for (const [name, m] of [
    ["gross", s.grossMarginTtm],
    ["operating", s.operatingMarginTtm],
    ["net", s.netMarginTtm],
  ] as const) {
    if (m !== null && (m > 1.05 || m < -3)) {
      downgrade("LOW", `Impossible ${name} margin (${(m * 100).toFixed(0)}%)`);
    }
  }

  // --- share count vs market cap cross-check ---------------------------------
  if (
    s.marketCap !== null &&
    s.sharesOutstanding !== null &&
    s.sharesOutstanding > 0 &&
    s.epsTtm !== null &&
    s.netIncomeTtm !== null &&
    s.netIncomeTtm > 0 &&
    s.epsTtm > 0
  ) {
    const impliedShares = s.netIncomeTtm / s.epsTtm;
    const ratio = impliedShares / s.sharesOutstanding;
    // Diluted-vs-basic and buybacks explain ±30%; a 3x gap means the share
    // count, EPS, or net income is wrong (classic million/billion slip).
    if (ratio > 3 || ratio < 1 / 3) {
      downgrade("LOW", "Share count inconsistent with EPS × net income");
    }
  }

  // --- multiple sanity ----------------------------------------------------------
  if (s.peTtm !== null && (s.peTtm < 0 || s.peTtm > 1000)) {
    downgrade("MEDIUM", `P/E outside sane bounds (${s.peTtm.toFixed(1)})`);
  }
  if (s.evToEbitda !== null && (s.evToEbitda < -100 || s.evToEbitda > 500)) {
    downgrade("MEDIUM", "EV/EBITDA outside sane bounds");
  }

  // --- estimates ------------------------------------------------------------------
  if (s.forwardEstimates.length === 0) {
    issues.push("No forward estimates available"); // informational, not a downgrade
  }

  return { ...s, meta: { ...s.meta, confidence: grade, issues } };
}

/** True when the snapshot may be used by valuation engines at all. */
export function usableForValuation(s: CompanySnapshot | null): s is CompanySnapshot {
  return s !== null && s.meta.confidence !== "INVALID";
}
