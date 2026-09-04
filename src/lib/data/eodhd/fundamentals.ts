import "server-only";
import { eodhdGet, eodhdNum, EodhdError } from "./client";
import {
  classifyCompany,
  sumComplete,
  yoyGrowth,
  cagr,
  type CompanySnapshot,
  type StatementRow,
} from "../normalize/company";
import { validateCompanySnapshot } from "../validation/company";
import { toEodhdCode } from "@/lib/providers/eodhd";
import { diskCache } from "@/lib/server/disk-cache";

/**
 * EODHD fundamentals → normalized CompanySnapshot.
 *
 * Field paths verified against real /api/fundamentals responses (NVDA.US,
 * JPM.US) on 2026-09-01. Statement numerics arrive as strings and pass through
 * `eodhdNum`, so a missing value is null everywhere — never zero, never "".
 *
 * Cached for 12h per symbol (fundamentals move on filing cadence, not ticks).
 */

const TTL_MS = 12 * 60 * 60_000;
/**
 * Persistent snapshot layer: the last SUCCESSFUL snapshot per symbol survives
 * restarts and provider-quota days. Freshness is judged by the snapshot's own
 * period metadata (dataDelayed), never by how recently the file was written —
 * a stale-period snapshot served from here still says DELAYED in the UI.
 */
const disk = diskCache<CompanySnapshot>("eodhd-fundamentals", TTL_MS);
const CACHE_KEY = Symbol.for("pcc.eodhd.fundamentals");
type Entry = { at: number; value: CompanySnapshot | null };
const cache: Map<string, Entry> = ((
  globalThis as unknown as Record<symbol, Map<string, Entry>>
)[CACHE_KEY] ??= new Map());

const FLIGHT_KEY = Symbol.for("pcc.eodhd.fundamentals.inflight");
const inflight: Map<string, Promise<CompanySnapshot | null>> = ((
  globalThis as unknown as Record<symbol, Map<string, Promise<CompanySnapshot | null>>>
)[FLIGHT_KEY] ??= new Map());

// ---------------------------------------------------------------- raw shapes

interface RawStatements {
  quarterly?: Record<string, Record<string, unknown>>;
  yearly?: Record<string, Record<string, unknown>>;
}

interface RawFundamentals {
  General?: Record<string, unknown>;
  Highlights?: Record<string, unknown>;
  Valuation?: Record<string, unknown>;
  SharesStats?: Record<string, unknown>;
  SplitsDividends?: Record<string, unknown>;
  AnalystRatings?: Record<string, unknown>;
  Holders?: { Institutions?: unknown; Funds?: unknown };
  Earnings?: {
    History?: Record<string, Record<string, unknown>>;
    Trend?: Record<string, Record<string, unknown>>;
    Annual?: Record<string, Record<string, unknown>>;
  };
  Financials?: {
    Income_Statement?: RawStatements;
    Balance_Sheet?: RawStatements;
    Cash_Flow?: RawStatements;
  };
  outstandingShares?: { quarterly?: Record<string, Record<string, unknown>> };
}

// ------------------------------------------------------------- normalization

function statementDates(fin: RawFundamentals["Financials"], kind: "quarterly" | "yearly"): string[] {
  const dates = new Set<string>();
  for (const st of [fin?.Income_Statement, fin?.Balance_Sheet, fin?.Cash_Flow]) {
    for (const d of Object.keys(st?.[kind] ?? {})) dates.add(d);
  }
  return [...dates].sort().reverse(); // newest first
}

function rowFor(
  fin: RawFundamentals["Financials"],
  kind: "quarterly" | "yearly",
  date: string,
): StatementRow {
  const is = fin?.Income_Statement?.[kind]?.[date] ?? {};
  const bs = fin?.Balance_Sheet?.[kind]?.[date] ?? {};
  const cf = fin?.Cash_Flow?.[kind]?.[date] ?? {};
  const n = eodhdNum;

  const ocf = n(cf["totalCashFromOperatingActivities"]);
  // EODHD reports capex as a negative outflow sometimes and positive others;
  // normalize to a POSITIVE spend figure.
  const capexRaw = n(cf["capitalExpenditures"]);
  const capex = capexRaw === null ? null : Math.abs(capexRaw);

  const shortDebt = n(bs["shortTermDebt"]);
  const longDebt = n(bs["longTermDebt"]);
  const totalDebtDirect = n(bs["shortLongTermDebtTotal"]);
  const totalDebt =
    totalDebtDirect ?? (shortDebt === null && longDebt === null ? null : (shortDebt ?? 0) + (longDebt ?? 0));

  const dividendsRaw = n(cf["dividendsPaid"]);
  return {
    date,
    filingDate: typeof is["filing_date"] === "string" ? (is["filing_date"] as string) : null,
    revenue: n(is["totalRevenue"]),
    costOfRevenue: n(is["costOfRevenue"]),
    grossProfit: n(is["grossProfit"]),
    rnd: n(is["researchDevelopment"]),
    sga: n(is["sellingGeneralAdministrative"]),
    operatingIncome: n(is["operatingIncome"]),
    ebit: n(is["ebit"]),
    ebitda: n(is["ebitda"]),
    pretaxIncome: n(is["incomeBeforeTax"]),
    taxExpense: n(is["incomeTaxExpense"]) ?? n(is["taxProvision"]),
    netIncome: n(is["netIncome"]),
    eps: null, // filled from earnings history by period in normalize()
    totalAssets: n(bs["totalAssets"]),
    currentAssets: n(bs["totalCurrentAssets"]),
    currentLiabilities: n(bs["totalCurrentLiabilities"]),
    inventory: n(bs["inventory"]),
    shortTermDebt: shortDebt,
    longTermDebt: longDebt,
    totalDebt,
    cash: n(bs["cashAndShortTermInvestments"]) ?? n(bs["cash"]),
    equity: n(bs["totalStockholderEquity"]),
    sharesOutstanding: n(bs["commonStockSharesOutstanding"]),
    operatingCashFlow: ocf,
    capex,
    freeCashFlow: ocf === null || capex === null ? null : ocf - capex,
    depreciation: n(cf["depreciation"]),
    stockComp: n(cf["stockBasedCompensation"]),
    dividendsPaid: dividendsRaw === null ? null : -Math.abs(dividendsRaw),
    buybacks: n(cf["salePurchaseOfStock"]),
  };
}

// ------------------------------------------------------- ratio derivations

/** Invested capital for one quarter: equity + total debt − cash. Null-safe. */
function investedCapital(r: StatementRow): number | null {
  if (r.equity === null || r.totalDebt === null) return null;
  return r.equity + r.totalDebt - (r.cash ?? 0);
}

/** Capital employed for one quarter: total assets − current liabilities. */
function capitalEmployed(r: StatementRow): number | null {
  if (r.totalAssets === null || r.currentLiabilities === null) return null;
  return r.totalAssets - r.currentLiabilities;
}

/**
 * Average a balance-sheet figure between the latest quarter and the same
 * quarter a year earlier (index 4). Falls back to the ending value when the
 * year-ago quarter is missing — ending capital, honestly, not a fake average.
 */
function averaged(
  quarterly: StatementRow[],
  pick: (r: StatementRow) => number | null,
): number | null {
  const now = quarterly[0] ? pick(quarterly[0]) : null;
  if (now === null) return null;
  const yearAgo = quarterly[4] ? pick(quarterly[4]) : null;
  return yearAgo === null ? now : (now + yearAgo) / 2;
}

function normalize(symbol: string, raw: RawFundamentals): CompanySnapshot {
  const n = eodhdNum;
  const g = raw.General ?? {};
  const h = raw.Highlights ?? {};
  const v = raw.Valuation ?? {};
  const ss = raw.SharesStats ?? {};
  const sd = raw.SplitsDividends ?? {};
  const ar = raw.AnalystRatings ?? {};

  const sector = (g["Sector"] as string) ?? null;
  const industry = (g["Industry"] as string) ?? null;
  const companyType = classifyCompany(sector, industry);
  const bankLike = companyType === "BANK" || companyType === "INSURANCE";

  // A valuation multiple of exactly 0 is impossible (a zero-priced or
  // zero-denominator company); providers use 0 as their missing marker.
  const nz = (x: number | null): number | null => (x === null || x === 0 ? null : x);

  const qDates = statementDates(raw.Financials, "quarterly").slice(0, 24);
  const aDates = statementDates(raw.Financials, "yearly").slice(0, 10);
  const quarterly = qDates.map((d) => rowFor(raw.Financials, "quarterly", d));
  const annual = aDates.map((d) => rowFor(raw.Financials, "yearly", d));

  const revenueTtm = sumComplete(quarterly.map((r) => r.revenue), 4);
  const netIncomeTtm = sumComplete(quarterly.map((r) => r.netIncome), 4);
  const ebitdaTtm = sumComplete(quarterly.map((r) => r.ebitda), 4);
  const ocfTtm = sumComplete(quarterly.map((r) => r.operatingCashFlow), 4);
  const capexTtm = sumComplete(quarterly.map((r) => r.capex), 4);
  const fcfTtm = ocfTtm === null || capexTtm === null ? null : ocfTtm - capexTtm;

  const priorYearRevTtm =
    quarterly.length >= 8 ? sumComplete(quarterly.slice(4).map((r) => r.revenue), 4) : null;

  const latestQ = quarterly[0] ?? null;
  const cash = latestQ?.cash ?? null;
  const totalDebt = latestQ?.totalDebt ?? null;
  const netDebt = cash === null || totalDebt === null ? null : totalDebt - cash;

  const marketCap = n(h["MarketCapitalization"]);
  // EV from the live market cap + our own balance sheet, so EV multiples stay
  // consistent with the price the user sees. Provider EV is the fallback.
  const enterpriseValue =
    marketCap !== null && netDebt !== null
      ? marketCap + netDebt
      : ((x: number | null) => (x === null || x === 0 ? null : x))(n(v["EnterpriseValue"]));
  const fcfYield = fcfTtm !== null && marketCap !== null && marketCap > 0 ? fcfTtm / marketCap : null;

  const grossMargin =
    revenueTtm !== null && revenueTtm > 0
      ? (() => {
          const gp = sumComplete(quarterly.map((r) => r.grossProfit), 4);
          return gp === null ? null : gp / revenueTtm;
        })()
      : null;
  const opMargin =
    revenueTtm !== null && revenueTtm > 0
      ? (() => {
          const oi = sumComplete(quarterly.map((r) => r.operatingIncome), 4);
          return oi === null ? null : oi / revenueTtm;
        })()
      : null;
  const netMargin =
    revenueTtm !== null && revenueTtm > 0 && netIncomeTtm !== null ? netIncomeTtm / revenueTtm : null;

  // Annual EPS series for CAGR (net income / shares as fallback-free proxy is
  // NOT used: EODHD gives EarningsShare TTM; 3y CAGR uses annual net income).
  const niAnnual = annual.map((r) => r.netIncome);
  const revAnnual = annual.map((r) => r.revenue);

  const trend = raw.Earnings?.Trend ?? {};
  const forwardEstimates = Object.values(trend)
    .map((t) => ({
      periodEnd: String(t["date"] ?? ""),
      epsAvg: n(t["earningsEstimateAvg"]),
      epsLow: n(t["earningsEstimateLow"]),
      epsHigh: n(t["earningsEstimateHigh"]),
      revenueAvg: n(t["revenueEstimateAvg"]),
      analystCount: n(t["earningsEstimateNumberOfAnalysts"]),
    }))
    .filter((t) => t.periodEnd && (t.epsAvg !== null || t.revenueAvg !== null))
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));

  const history = raw.Earnings?.History ?? {};
  // FRESHNESS DISCOVERY (separate concern from the graded-surprise list below):
  // a quarter counts as REPORTED the day its reportDate passes, even before
  // the provider grades epsActual — statements lagging that date = DELAYED.
  const today = new Date().toISOString().slice(0, 10);
  const reportedRows = Object.values(history)
    .map((e) => ({ reportDate: String(e["reportDate"] ?? ""), periodEnd: String(e["date"] ?? "") }))
    .filter((e) => e.periodEnd && e.reportDate && e.reportDate <= today)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  const latestReported = reportedRows[0] ?? null;
  const earningsHistory = Object.values(history)
    .map((e) => ({
      reportDate: String(e["reportDate"] ?? ""),
      periodEnd: String(e["date"] ?? ""),
      epsActual: n(e["epsActual"]),
      epsEstimate: n(e["epsEstimate"]),
      surprisePct: n(e["surprisePercent"]),
    }))
    .filter((e) => e.periodEnd && e.epsActual !== null)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
    .slice(0, 12);

  // Reported diluted EPS is only published per period in the earnings history;
  // attach it to the matching statement quarter so panels can show real EPS.
  const epsByPeriod = new Map(earningsHistory.map((e) => [e.periodEnd, e.epsActual]));
  for (const row of quarterly) {
    const direct = epsByPeriod.get(row.date);
    if (direct !== undefined) row.eps = direct;
  }

  // ---- capital-return ratios, from reported statements only (audit spec §1).
  const ebitTtm =
    sumComplete(quarterly.map((r) => r.ebit), 4) ??
    sumComplete(quarterly.map((r) => r.operatingIncome), 4);
  const taxTtm = sumComplete(quarterly.map((r) => r.taxExpense), 4);
  const pretaxTtm = sumComplete(quarterly.map((r) => r.pretaxIncome), 4);
  const taxRate =
    taxTtm !== null && pretaxTtm !== null && pretaxTtm > 0
      ? Math.min(0.5, Math.max(0, taxTtm / pretaxTtm))
      : null;
  const avgInvested = averaged(quarterly, investedCapital);
  const roic =
    ebitTtm !== null && taxRate !== null && avgInvested !== null && avgInvested > 0
      ? (ebitTtm * (1 - taxRate)) / avgInvested
      : null;
  const avgCapEmployed = averaged(quarterly, capitalEmployed);
  const roce =
    ebitTtm !== null && avgCapEmployed !== null && avgCapEmployed > 0
      ? ebitTtm / avgCapEmployed
      : null;

  const snapshot: CompanySnapshot = {
    identity: {
      symbol,
      name: (g["Name"] as string) ?? null,
      exchange: (g["Exchange"] as string) ?? null,
      currency: (g["CurrencyCode"] as string) ?? null,
      sector,
      industry,
      description: (g["Description"] as string) ?? null,
      country: (g["CountryName"] as string) ?? null,
      employees: n(g["FullTimeEmployees"]),
      companyType,
    },

    marketCap,
    sharesOutstanding: n(ss["SharesOutstanding"]),
    floatShares: n(ss["SharesFloat"]),

    // Negative/zero trailing EPS makes P/E meaningless — publish null, not a
    // sign-flipped or astronomical number (spec: data quality gates).
    peTtm: (n(h["EarningsShare"]) ?? 0) > 0 ? nz(n(v["TrailingPE"]) ?? n(h["PERatio"])) : null,
    forwardPe: nz(n(v["ForwardPE"])),
    peg: nz(n(h["PEGRatio"])),
    // Price multiples are SELF-COMPUTED from the daily market cap and our own
    // normalized statements. EODHD's Valuation block lags the price by days —
    // the live ratio audit caught AVGO's provider P/B, P/S and EV/x all ~18%
    // stale after a sharp move. Provider values remain the fallback only.
    // Banks keep the provider P/S: their "sales" basis is net revenue, not the
    // gross interest income our totalRevenue line carries.
    priceToSales:
      !bankLike && marketCap !== null && revenueTtm !== null && revenueTtm > 0
        ? marketCap / revenueTtm
        : nz(n(v["PriceSalesTTM"])),
    priceToBook:
      marketCap !== null && latestQ?.equity != null && latestQ.equity > 0
        ? marketCap / latestQ.equity
        : nz(n(v["PriceBookMRQ"])),
    enterpriseValue: enterpriseValue,
    // EBITDA-based multiples are meaningless for banks and insurers (no real
    // EBITDA concept); EODHD publishes 0 there, which the zero-gate rejects,
    // and the type gate makes the suppression explicit rather than incidental.
    evToEbitda:
      bankLike
        ? null
        : enterpriseValue !== null && ebitdaTtm !== null && ebitdaTtm > 0
          ? enterpriseValue / ebitdaTtm
          : nz(n(v["EnterpriseValueEbitda"])),
    evToRevenue:
      bankLike
        ? null
        : enterpriseValue !== null && revenueTtm !== null && revenueTtm > 0
          ? enterpriseValue / revenueTtm
          : nz(n(v["EnterpriseValueRevenue"])),
    fcfYield,

    epsTtm: n(h["EarningsShare"]),
    bookValuePerShare: n(h["BookValue"]),
    dividendYield: n(h["DividendYield"]),
    payoutRatio: n(sd["PayoutRatio"]),
    grossMarginTtm: grossMargin,
    operatingMarginTtm: opMargin,
    netMarginTtm: netMargin,
    fcfMargin:
      fcfTtm !== null && revenueTtm !== null && revenueTtm > 0 ? fcfTtm / revenueTtm : null,
    roe: n(h["ReturnOnEquityTTM"]),
    roa: n(h["ReturnOnAssetsTTM"]),
    roic,
    roce,

    revenueTtm,
    netIncomeTtm,
    ebitdaTtm,
    operatingCashFlowTtm: ocfTtm,
    capexTtm,
    freeCashFlowTtm: fcfTtm,

    cash,
    totalDebt,
    netDebt,
    equity: latestQ?.equity ?? null,
    netDebtToEbitda:
      !bankLike && netDebt !== null && ebitdaTtm !== null && ebitdaTtm > 0
        ? netDebt / ebitdaTtm
        : null,
    debtToEquity:
      totalDebt !== null && latestQ?.equity !== null && latestQ !== null && latestQ.equity! > 0
        ? totalDebt / latestQ.equity!
        : null,
    currentRatio:
      latestQ?.currentAssets != null && latestQ?.currentLiabilities != null && latestQ.currentLiabilities > 0
        ? latestQ.currentAssets / latestQ.currentLiabilities
        : null,
    quickRatio:
      latestQ?.currentAssets != null && latestQ?.currentLiabilities != null && latestQ.currentLiabilities > 0
        ? (latestQ.currentAssets - (latestQ.inventory ?? 0)) / latestQ.currentLiabilities
        : null,

    revenueGrowthYoY: yoyGrowth(revenueTtm, priorYearRevTtm),
    epsGrowthYoY: n(h["QuarterlyEarningsGrowthYOY"]),
    revenueCagr3y: annual.length >= 4 ? cagr(revAnnual[0] ?? null, revAnnual[3] ?? null, 3) : null,
    epsCagr3y: annual.length >= 4 ? cagr(niAnnual[0] ?? null, niAnnual[3] ?? null, 3) : null,

    analystRating: n(ar["Rating"]),
    analystTargetPrice: n(ar["TargetPrice"]),
    analystCounts: {
      strongBuy: n(ar["StrongBuy"]),
      buy: n(ar["Buy"]),
      hold: n(ar["Hold"]),
      sell: n(ar["Sell"]),
      strongSell: n(ar["StrongSell"]),
    },
    epsEstimateCurrentYear: n(h["EPSEstimateCurrentYear"]),
    epsEstimateNextYear: n(h["EPSEstimateNextYear"]),
    forwardEstimates,

    insiderOwnershipPct: n(ss["PercentInsiders"]),
    institutionalOwnershipPct: n(ss["PercentInstitutions"]),

    quarterly,
    annual,
    earningsHistory,

    meta: {
      source: "eodhd",
      fetchedAt: new Date().toISOString(),
      period: latestQ ? `${latestQ.date} (Q)` : null,
      currency: (g["CurrencyCode"] as string) ?? null,
      confidence: "HIGH", // provisional; validation below may downgrade
      issues: [],
      // Period freshness: has a NEWER quarter been REPORTED (earnings
      // history) than the newest quarter present in the statements?
      latestStatementPeriod: latestQ?.date ?? null,
      latestReportedPeriod: latestReported?.periodEnd ?? null,
      latestReportDate: latestReported?.reportDate ?? null,
      dataDelayed:
        latestQ !== null && latestReported !== null && latestReported.periodEnd > latestQ.date,
    },
  };

  return validateCompanySnapshot(snapshot);
}

// -------------------------------------------------------------------- public

/**
 * Normalized fundamentals for one symbol, or null when EODHD cannot serve it
 * (BIST and non-US symbols return null so callers fall back / render N/A —
 * never zeros).
 */
export async function getCompanySnapshot(
  symbol: string,
  opts: { force?: boolean } = {},
): Promise<CompanySnapshot | null> {
  const code = toEodhdCode(symbol);
  if (!code || !code.endsWith(".US")) return null;

  const key = symbol.toUpperCase();
  let hit = cache.get(key);
  // Cold process: hydrate the memory layer from the persisted snapshot so a
  // restart (or a quota-blocked day) still serves the last good data.
  if (!hit) {
    const persisted = disk.get(key);
    if (persisted) {
      const at = Date.parse(persisted.meta.fetchedAt) || 0;
      hit = { at, value: persisted };
      cache.set(key, hit);
    }
  }
  if (!opts.force && hit && Date.now() - hit.at < TTL_MS) {
    // Earnings-aware revalidation (spec §20): a cache that KNOWS a newer
    // quarter was reported than its statements contain re-checks the provider
    // on a much shorter clock until the full statements arrive. A cache with
    // an earnings report expected/just passed also shortens its clock.
    const v = hit.value;
    const delayedTtl = 2 * 60 * 60_000;
    const isDelayed = v?.meta.dataDelayed === true;
    if (!isDelayed || Date.now() - hit.at < delayedTtl) return v;
    // fall through to refetch
  }

  const running = inflight.get(key);
  if (running) return running;

  const p = (async () => {
    try {
      const raw = await eodhdGet<RawFundamentals>(`/fundamentals/${encodeURIComponent(code)}`);
      const snap = normalize(key, raw);
      cache.set(key, { at: Date.now(), value: snap });
      disk.set(key, snap);
      return snap;
    } catch (e) {
      if (e instanceof EodhdError && !e.transient) {
        // Remember hard misses so an unlisted ticker doesn't re-fetch hourly.
        cache.set(key, { at: Date.now(), value: null });
        return null;
      }
      // Transient (incl. quota 402): serve the last good snapshot — its own
      // period metadata keeps the freshness banner honest.
      return hit?.value ?? disk.get(key) ?? null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}
