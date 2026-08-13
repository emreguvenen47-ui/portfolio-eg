import type { FinancialPeriod, KeyMetrics } from "@/lib/providers/fundamentals";
import { bistListing } from "@/lib/providers/bist";

/**
 * What kind of business is this, and which metrics actually mean anything?
 *
 * Banks are the case that matters. A bank has no cost of goods, so "gross
 * margin" is undefined; it funds itself with deposits and borrowings, so
 * "net debt" and "debt/equity" describe its business model rather than its
 * risk; and capital expenditure is trivial, so "free cash flow" measures
 * nothing useful. Showing an industrial metric set against a bank does not
 * merely look odd — it produces confident, wrong readings, like flagging a
 * healthy bank for having more debt than equity.
 *
 * Classification is explicit rather than inferred from the numbers: a filer
 * that happens to omit `GrossProfit` one quarter is not thereby a bank.
 */

export type CompanyKind = "bank" | "insurer" | "reit" | "operating";

/** US and other non-BIST financials we care about, by ticker. */
const US_BANKS = new Set([
  "JPM", "BAC", "WFC", "C", "GS", "MS", "USB", "PNC", "TFC", "SCHW",
  "COF", "BK", "STT", "FITB", "HBAN", "RF", "KEY", "CFG", "MTB", "ALLY",
]);
const INSURERS = new Set(["BRK.B", "PGR", "ALL", "TRV", "AIG", "MET", "PRU", "CB", "AFL", "HIG"]);
const REITS = new Set(["O", "PLD", "AMT", "CCI", "SPG", "EQIX", "PSA", "VICI", "WELL", "DLR"]);

export function companyKind(symbol: string): CompanyKind {
  const s = symbol.trim().toUpperCase();
  if (bistListing(s)?.isBank) return "bank";
  if (US_BANKS.has(s)) return "bank";
  if (INSURERS.has(s)) return "insurer";
  if (REITS.has(s)) return "reit";
  return "operating";
}

export const isBankLike = (symbol: string): boolean => {
  const k = companyKind(symbol);
  return k === "bank" || k === "insurer";
};

/**
 * Normalised metric key.
 *
 * Callers identify metrics by different spellings — a spec key, a UI label —
 * so everything is folded to letters-only lowercase. Without this the
 * suppression set silently misses (`grossMargin` vs `grossmargin` vs
 * `"Gross Margin"`), and a bank quietly gets an industrial metric back.
 */
export const metricKey = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, "");

/**
 * Metrics that are meaningless for the given business, and must render N/A
 * with a reason rather than a computed number.
 */
export function suppressedMetrics(kind: CompanyKind): Set<string> {
  if (kind === "bank" || kind === "insurer") {
    return new Set(
      [
        "grossMargin",
        "grossProfit",
        "fcfMargin",
        "freeCashFlow",
        "fcfPerShare",
        "fcfToNetIncome",
        "netDebt",
        "debtToEquity",
        "currentRatio",
        "capex",
        "roic",
        "evEbitda",
        "fcfYield",
      ].map(metricKey),
    );
  }
  if (kind === "reit") {
    // Depreciation dominates a REIT's income statement, so net-income-based
    // margins and P/E mislead. FFO would be the right basis; it is not in the
    // reported feed, so those rows stay off rather than being approximated.
    return new Set(["grossMargin", "netMargin", "peRatio"].map(metricKey));
  }
  return new Set();
}

export const SUPPRESSION_REASON: Record<CompanyKind, string> = {
  bank: "Not meaningful for a bank: no cost of goods, deposits and borrowings are funding rather than leverage risk, and capital spending is immaterial.",
  insurer:
    "Not meaningful for an insurer: premiums and reserves do not map onto cost of goods, and float is not debt in the industrial sense.",
  reit: "Not meaningful for a REIT: depreciation dominates reported earnings, so FFO rather than net income is the right basis.",
  operating: "",
};

/** Bank-appropriate headline metrics, from data the providers actually carry. */
export interface BankMetrics {
  roe: number | null;
  roa: number | null;
  bookValuePerShare: number | null;
  priceToBook: number | null;
  netIncome: number | null;
  netIncomeGrowth: number | null;
  equity: number | null;
  totalAssets: number | null;
  equityToAssets: number | null;
  /** Not carried by any configured provider. */
  capitalAdequacy: null;
  nplRatio: null;
  netInterestMargin: null;
}

export function bankMetrics(
  m: KeyMetrics | null,
  periods: FinancialPeriod[],
): BankMetrics {
  const num = (v: number | string | undefined): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const last = periods.at(-1) ?? null;
  const yearAgo = periods.length >= 5 ? periods[periods.length - 5] : null;

  const ttmNi = (() => {
    const w = periods.slice(-4);
    if (w.length < 4) return null;
    return w.reduce<number | null>(
      (s, p) => (s === null || p.netIncome === null ? null : s + p.netIncome),
      0,
    );
  })();

  const priorNi = (() => {
    const w = periods.slice(-8, -4);
    if (w.length < 4) return null;
    return w.reduce<number | null>(
      (s, p) => (s === null || p.netIncome === null ? null : s + p.netIncome),
      0,
    );
  })();

  // The provider metric bag has no BIST coverage, so where it is empty these
  // are derived from the filed statements instead: trailing net income over
  // reported equity and assets. Same definition, computed rather than looked
  // up, and still null when the inputs are missing.
  const derivedRoe =
    ttmNi !== null && last?.equity ? (ttmNi / last.equity) * 100 : null;
  const derivedRoa =
    ttmNi !== null && last?.totalAssets ? (ttmNi / last.totalAssets) * 100 : null;

  return {
    roe: num(m?.roeTTM) ?? derivedRoe,
    roa: num(m?.roaTTM) ?? derivedRoa,
    bookValuePerShare: num(m?.bookValuePerShareQuarterly),
    priceToBook: num(m?.pbQuarterly),
    netIncome: ttmNi,
    netIncomeGrowth:
      ttmNi !== null && priorNi !== null && priorNi !== 0
        ? ((ttmNi - priorNi) / Math.abs(priorNi)) * 100
        : null,
    equity: last?.equity ?? null,
    totalAssets: last?.totalAssets ?? null,
    // Equity over assets is the closest thing to a capital ratio that reported
    // statements support. It is NOT a regulatory capital adequacy ratio, and
    // is labelled as such wherever it renders.
    equityToAssets:
      last?.equity != null && last?.totalAssets ? (last.equity / last.totalAssets) * 100 : null,
    capitalAdequacy: null,
    nplRatio: null,
    netInterestMargin: null,
  };
}

/** Why the regulatory ratios are blank, stated once for the UI to reuse. */
export const BANK_GAP_NOTE =
  "Capital adequacy, NPL ratio and net interest margin come from regulatory filings (BDDK for Turkish banks, FR Y-9C for US banks) that no configured provider carries. They read N/A rather than being approximated from the income statement.";
