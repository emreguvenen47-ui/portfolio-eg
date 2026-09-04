import "server-only";
import { refund, trySpend } from "./budget";
import type { FinancialPeriod } from "./fundamentals";

/**
 * Financial Modeling Prep: filed statements, with the balance sheet as the
 * reason it is here.
 *
 * The SEC path builds a balance sheet by matching XBRL concepts, which works
 * until a filer tags the same economic line differently — and then a perfectly
 * normal company reports null total debt. FMP publishes the same filings
 * already normalised onto fixed field names, so `totalAssets` is `totalAssets`
 * for every issuer. It also lands a quarter sooner than the SEC-derived feed
 * for large caps: for AAPL it carried the June 2026 quarter while the primary
 * source still stopped at March.
 *
 * Two things about the API are worth writing down, because both look like a
 * broken key when you meet them:
 *
 *   1. The `/api/v3/...` endpoints are retired. They answer 403 with a message
 *      about legacy subscriptions regardless of how valid your key is. Current
 *      keys only work against `/stable/...`, which is what this module uses.
 *
 *   2. Non-US symbols answer 402 on the entry plans. THYAO.IS and ASML.AS both
 *      do. That is a plan boundary, not an outage and not an uncovered company,
 *      so it must not surface as an error or evict the SEC data — see
 *      `unsupported` below.
 *
 * Cached for a day, matching the other fundamentals sources: statements change
 * quarterly, so re-fetching them on a quote clock would be pure waste.
 */

const BASE = "https://financialmodelingprep.com/stable";
const CACHE_TTL_MS = 24 * 60 * 60_000;
const TIMEOUT_MS = 15_000;

/**
 * Budget key. The cap comes from `FMP_DAILY_BUDGET`, defaulting to the shared
 * fallback-source figure in `budget.ts`.
 *
 * The entry plans allow a few hundred requests a day, and one symbol costs two
 * (the quarterly and annual balance sheets). That is affordable on a research
 * page a person is reading and ruinous across a screener universe, so this
 * module is metered and callers in bulk paths are expected not to use it —
 * see the note on `getFmpBalanceSheets`.
 */
const BUDGET = "fmp";

/** Requests one symbol costs: the quarterly and the annual balance sheet. */
const CREDITS_PER_SYMBOL = 2;

/**
 * Periods to request.
 *
 * Five is the ceiling on the entry plans — `limit=8` answers 402 with a message
 * about the *parameter*, not the symbol, which is a distinction the error
 * handling below has to make. Five quarters is enough for a year-on-year
 * comparison and for repairing the balance sheet, which is what this source is
 * for; the SEC path still supplies the longer history.
 */
const QUARTERS = 5;
const YEARS = 5;

export const isFmpConfigured = (): boolean => Boolean(process.env.FMP_API_KEY?.trim());

const key = (): string | null => process.env.FMP_API_KEY?.trim() || null;

// --------------------------------------------------------------------- cache

const CACHE_KEY = Symbol.for("pcc.fmp.cache");
const cache: Map<string, { at: number; value: unknown }> = ((
  globalThis as unknown as Record<symbol, Map<string, { at: number; value: unknown }>>
)[CACHE_KEY] ??= new Map());

const FLIGHT_KEY = Symbol.for("pcc.fmp.inflight");
const inflight: Map<string, Promise<unknown>> = ((
  globalThis as unknown as Record<symbol, Map<string, Promise<unknown>>>
)[FLIGHT_KEY] ??= new Map());

/**
 * Symbols this plan does not carry.
 *
 * Remembered for the process lifetime because a plan boundary does not move.
 * Without it every screener pass would spend a call per BIST ticker to be told
 * the same thing, which is the one failure mode that turns a free tier into a
 * rate-limit problem.
 */
const UNSUPPORTED_KEY = Symbol.for("pcc.fmp.unsupported");
const unsupported: Set<string> = ((
  globalThis as unknown as Record<symbol, Set<string>>
)[UNSUPPORTED_KEY] ??= new Set());

async function cached<T>(cacheKey: string, load: () => Promise<T>): Promise<T | null> {
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;

  const running = inflight.get(cacheKey) as Promise<T | null> | undefined;
  if (running) return running;

  const p = (async () => {
    try {
      const value = await load();
      cache.set(cacheKey, { at: Date.now(), value });
      return value;
    } catch {
      // Serve the previous pull rather than blanking a panel on one blip.
      return (hit?.value as T) ?? null;
    }
  })().finally(() => inflight.delete(cacheKey));

  inflight.set(cacheKey, p);
  return p;
}

// ---------------------------------------------------------------------- http

/** Raised when the plan does not cover a symbol. Carries no diagnostic weight. */
class UnsupportedSymbol extends Error {}

async function get<T>(path: string, symbol: string): Promise<T[]> {
  const token = key();
  if (!token) throw new Error("FMP_API_KEY not configured");

  const url = `${BASE}/${path}${path.includes("?") ? "&" : "?"}apikey=${token}`;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 402) {
    // 402 covers two unrelated situations and they must not be conflated.
    //
    //   "This value set for 'symbol' is not available under your current
    //    subscription"          -> the plan does not carry this company.
    //   "The values for 'limit' must be between 0 and 5"
    //                           -> the plan does carry it; we asked wrongly.
    //
    // Treating the second as the first would blacklist a working US symbol for
    // the lifetime of the process over a request we could simply have made
    // correctly, and the panel would read as uncovered for no reason.
    const body = await res.text().catch(() => "");
    if (/'symbol'/.test(body)) {
      unsupported.add(symbol);
      throw new UnsupportedSymbol(symbol);
    }
    throw new Error(
      `FMP plan limit on this request: ${body.replace(/\s+/g, " ").trim().slice(0, 180)}`,
    );
  }
  if (res.status === 401) throw new Error("FMP rejected the key (401)");
  if (res.status === 403) {
    // Either a retired v3 path or a plan restriction. Say which, because the
    // message FMP returns for the first reads exactly like an invalid key.
    throw new Error(
      "FMP refused the request (403). If this path is under /api/v3 it is retired — " +
        "current keys only work against /stable.",
    );
  }
  if (!res.ok) throw new Error(`FMP HTTP ${res.status}`);

  const json: unknown = await res.json();

  // Errors arrive as a 200 with an object body on some paths.
  if (json && !Array.isArray(json) && typeof json === "object") {
    const msg =
      (json as { "Error Message"?: string })["Error Message"] ??
      (json as { message?: string }).message;
    if (msg) throw new Error(`FMP: ${String(msg).slice(0, 160)}`);
  }

  return Array.isArray(json) ? (json as T[]) : [];
}

// ------------------------------------------------------------------ mapping

/** FMP omits nothing, but it does report an unfiled line as 0. */
const n = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Zero-as-absent, for lines where a real zero is implausible.
 *
 * FMP writes 0 rather than null for a line the filer did not report, so
 * `goodwill: 0` is genuinely "no goodwill" but `totalAssets: 0` is "missing".
 * Applied only where zero cannot be a real filed value.
 */
const positive = (v: unknown): number | null => {
  const x = n(v);
  return x === null || x === 0 ? null : x;
};

interface FmpRow {
  date?: string;
  symbol?: string;
  reportedCurrency?: string;
  filingDate?: string;
  acceptedDate?: string;
  fiscalYear?: string;
  period?: string;
  [field: string]: unknown;
}

/** `2026-06-27` — FMP's own format, but normalised defensively. */
const dayOf = (raw: string | undefined): string | null =>
  raw && raw.length >= 10 ? raw.slice(0, 10) : null;

/** `Q1`..`Q4` → 1..4; `FY` → 0. */
function quarterOf(period: string | undefined, annual: boolean): number {
  if (annual) return 0;
  const m = /^Q([1-4])$/.exec(period ?? "");
  return m?.[1] ? Number(m[1]) : 0;
}

/**
 * Merge the three statements for one period into the app's shape.
 *
 * Quarters are discrete as filed — FMP reports the quarter, not the
 * year-to-date — so the de-cumulation the SEC path needs is deliberately not
 * applied here.
 */
function toPeriod(
  income: FmpRow | undefined,
  balance: FmpRow | undefined,
  cash: FmpRow | undefined,
  endDate: string,
  annual: boolean,
): FinancialPeriod {
  const anchor = balance ?? income ?? cash;
  const fiscalYear = Number(anchor?.fiscalYear ?? endDate.slice(0, 4));

  const ocf = n(cash?.operatingCashFlow) ?? n(cash?.netCashProvidedByOperatingActivities);
  const capex = n(cash?.capitalExpenditure);

  return {
    year: Number.isFinite(fiscalYear) ? fiscalYear : Number(endDate.slice(0, 4)),
    quarter: quarterOf(anchor?.period, annual),
    endDate,
    discrete: true,

    // income
    revenue: n(income?.revenue),
    costOfRevenue: n(income?.costOfRevenue),
    grossProfit: n(income?.grossProfit),
    rnd: n(income?.researchAndDevelopmentExpenses),
    sga: n(income?.sellingGeneralAndAdministrativeExpenses),
    operatingIncome: n(income?.operatingIncome),
    pretaxIncome: n(income?.incomeBeforeTax),
    taxExpense: n(income?.incomeTaxExpense),
    netIncome: n(income?.netIncome),
    eps: n(income?.epsDiluted) ?? n(income?.eps),
    dilutedShares: positive(income?.weightedAverageShsOutDil),

    // cash flow
    operatingCashFlow: ocf,
    capex,
    freeCashFlow:
      n(cash?.freeCashFlow) ??
      (ocf !== null && capex !== null ? ocf - Math.abs(capex) : null),
    depreciation: n(cash?.depreciationAndAmortization),
    stockComp: n(cash?.stockBasedCompensation),
    dividendsPaid: n(cash?.netDividendsPaid) ?? n(cash?.commonDividendsPaid),
    buybacks: n(cash?.commonStockRepurchased),
    stockIssued: n(cash?.commonStockIssuance),
    // FMP reports debt movement net (`netDebtIssuance`), not as gross issuance
    // and repayment. Splitting a net figure into two gross ones would invent
    // the split, so both stay null — the same choice the Yahoo path makes.
    debtIssued: null,
    debtRepaid: null,

    // balance sheet — the reason this provider exists
    cash: n(balance?.cashAndCashEquivalents),
    shortTermInvestments: n(balance?.shortTermInvestments),
    totalAssets: positive(balance?.totalAssets),
    currentAssets: positive(balance?.totalCurrentAssets),
    currentLiabilities: positive(balance?.totalCurrentLiabilities),
    totalLiabilities: positive(balance?.totalLiabilities),
    equity: n(balance?.totalStockholdersEquity) ?? n(balance?.totalEquity),
    shortTermDebt: n(balance?.shortTermDebt),
    longTermDebt: n(balance?.longTermDebt),
    inventory: n(balance?.inventory),
  };
}

/** Index rows by period end date, newest first. */
function byDate(rows: FmpRow[]): Map<string, FmpRow> {
  const out = new Map<string, FmpRow>();
  for (const row of rows) {
    const day = dayOf(row.date);
    if (day && !out.has(day)) out.set(day, row);
  }
  return out;
}

/**
 * One side of the balance sheet — quarterly or annual. One request.
 *
 * Only the balance sheet is fetched. The income statement and cash flow are
 * already well covered by the SEC path, and pulling them would triple the
 * request cost for figures nothing here would use.
 */
async function loadSide(
  symbol: string,
  annual: boolean,
): Promise<{ periods: FinancialPeriod[]; balance: FmpRow[] }> {
  const period = annual ? "annual" : "quarter";
  const limit = annual ? YEARS : QUARTERS;
  const balance = await get<FmpRow>(
    `balance-sheet-statement?symbol=${encodeURIComponent(symbol)}&period=${period}&limit=${limit}`,
    symbol,
  );

  const bs = byDate(balance);
  const periods = [...bs.keys()]
    .map((day) => toPeriod(undefined, bs.get(day), undefined, day, annual))
    .sort((a, b) => (a.endDate < b.endDate ? 1 : -1));

  return { periods, balance };
}

// ----------------------------------------------------------------- statements

export interface FmpBalanceSheets {
  currency: string;
  /**
   * Newest first. Balance-sheet fields only — the income and cash-flow fields
   * are present because they belong to `FinancialPeriod`, and null because
   * fetching them would cost two more requests per period for figures the SEC
   * path already carries. These are donors for `fillBalanceSheet`, not a
   * substitute for a full set of statements.
   */
  quarterly: FinancialPeriod[];
  annual: FinancialPeriod[];
  /** Latest filing date seen, so a panel can say how current this is. */
  asOf: string | null;
  source: string;
  sourceUrl: string;
  /**
   * Total and net debt exactly as FMP reports them.
   *
   * The app derives both from the debt lines. Keeping the reported figures
   * lets the two be compared instead of silently trusting the derivation.
   * Keyed by period end date.
   */
  reportedDebt: Record<string, { totalDebt: number | null; netDebt: number | null }>;
}

/**
 * Filed balance sheets for one symbol, or null when they are not available.
 *
 * Null covers three different situations on purpose, because to a caller they
 * mean the same thing — use the source you already have:
 *   - no key configured
 *   - the plan does not carry this symbol (every non-US ticker on entry tiers)
 *   - the daily request budget is spent
 *
 * Costs two requests, metered against `FMP_DAILY_BUDGET`. Do not call this per
 * row in a screener or scanner pass: a universe sweep would spend the day's
 * allowance before the research pages that need it get a look in.
 */
export async function getFmpBalanceSheets(symbol: string): Promise<FmpBalanceSheets | null> {
  if (!isFmpConfigured()) return null;

  const ticker = symbol.trim().toUpperCase();
  if (!ticker || unsupported.has(ticker)) return null;

  // A cached answer costs nothing, so the budget is only consulted on a miss.
  const hit = cache.get(`fmp:${ticker}`);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.value as FmpBalanceSheets | null;
  }

  if (!trySpend(BUDGET, CREDITS_PER_SYMBOL)) return null;
  let charged = true;

  return cached<FmpBalanceSheets | null>(`fmp:${ticker}`, async () => {
    const giveBack = () => {
      if (charged) {
        refund(BUDGET, CREDITS_PER_SYMBOL);
        charged = false;
      }
    };

    let q: { periods: FinancialPeriod[]; balance: FmpRow[] };
    let a: { periods: FinancialPeriod[]; balance: FmpRow[] };

    try {
      [q, a] = await Promise.all([
        loadSide(ticker, false),
        loadSide(ticker, true).catch(() => ({
          periods: [] as FinancialPeriod[],
          balance: [] as FmpRow[],
        })),
      ]);
    } catch (err) {
      // Nothing usable came back, so the reservation was not really consumed.
      // Handing it back matters most for the plan-boundary case: a screener
      // touching fifty BIST tickers would otherwise burn the whole day's
      // allowance discovering fifty times that they are not covered.
      giveBack();
      if (err instanceof UnsupportedSymbol) return null;
      throw err;
    }

    const quarterly = q.periods;
    const annual = a.periods;
    if (quarterly.length === 0 && annual.length === 0) {
      giveBack();
      return null;
    }

    // The debt aggregates rode along with the balance sheet we already have.
    // `toPeriod` does not carry them into `FinancialPeriod` because that type
    // has no field for a reported aggregate, so they are collected here.
    const reportedDebt: FmpBalanceSheets["reportedDebt"] = {};
    for (const row of [...q.balance, ...a.balance]) {
      const day = dayOf(row.date);
      if (!day || reportedDebt[day]) continue;
      reportedDebt[day] = { totalDebt: n(row.totalDebt), netDebt: n(row.netDebt) };
    }

    const raw = q.balance.length > 0 ? q.balance : a.balance;
    const newest = quarterly[0] ?? annual[0] ?? null;
    const currency =
      (raw[0]?.reportedCurrency as string | undefined)?.trim().toUpperCase() || "USD";

    return {
      currency,
      quarterly,
      annual,
      asOf: (raw[0]?.filingDate as string | undefined) ?? newest?.endDate ?? null,
      source: "Financial Modeling Prep",
      sourceUrl: `https://site.financialmodelingprep.com/financial-statements/${ticker}`,
      reportedDebt,
    };
  });
}

// -------------------------------------------------------------- balance sheet

/** The balance-sheet fields on a period — point in time, never cumulative. */
const BALANCE_KEYS = [
  "cash",
  "shortTermInvestments",
  "totalAssets",
  "currentAssets",
  "currentLiabilities",
  "totalLiabilities",
  "equity",
  "shortTermDebt",
  "longTermDebt",
  "inventory",
] as const satisfies readonly (keyof FinancialPeriod)[];

/**
 * Fields that only exist on a classified balance sheet.
 *
 * Banks and insurers do not present one — there is no current/non-current
 * split in a bank's filing, and no inventory. FMP returns figures for these
 * anyway (JPM comes back with `totalCurrentAssets` of 3.2 trillion), which is
 * FMP's own bucketing of the balance sheet rather than a line the filer
 * reported. Writing it into a field the rest of the app reads as "as filed"
 * would launder a derived number into the record, so for bank-like issuers
 * these stay null — which is also what the SEC path correctly produces.
 */
const CLASSIFIED_KEYS: ReadonlySet<string> = new Set([
  "currentAssets",
  "currentLiabilities",
  "inventory",
]);

export interface FillOptions {
  /**
   * True for a bank or insurer. Suppresses the classified-balance-sheet fields
   * above. Callers get this from `isBankLike(symbol)`.
   */
  bankLike?: boolean;
}

/** Filings a few days apart are the same period; a different month is not. */
const SAME_PERIOD_DAYS = 12;

function withinDays(a: string, b: string, days: number): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return Math.abs(ta - tb) <= days * 86_400_000;
}

export interface BalanceSheetFill {
  periods: FinancialPeriod[];
  /** How many individual balance-sheet cells FMP supplied. */
  filled: number;
  /** Period end dates that were repaired. */
  repaired: string[];
}

/**
 * Fill balance-sheet gaps in already-built periods from FMP.
 *
 * Only nulls are written. A figure the primary source filed stays exactly as
 * filed, so this can never move a number the SEC path got right — it only
 * turns blank cells into filed ones.
 *
 * Periods are matched on end date rather than on (year, quarter). Fiscal
 * labelling is the trap here: Apple's fiscal Q3 ends in June, which a
 * calendar-derived source calls Q2, so matching on the label pairs the wrong
 * quarters together. The end date is unambiguous. A few days of slack absorbs
 * the 52/53-week filers whose period end drifts between sources.
 */
export function fillBalanceSheet(
  periods: FinancialPeriod[],
  fmp: FmpBalanceSheets | null,
  options: FillOptions = {},
): BalanceSheetFill {
  if (!fmp || periods.length === 0) return { periods, filled: 0, repaired: [] };

  const fields = options.bankLike
    ? BALANCE_KEYS.filter((f) => !CLASSIFIED_KEYS.has(f))
    : BALANCE_KEYS;

  const donors = [...fmp.quarterly, ...fmp.annual];
  if (donors.length === 0) return { periods, filled: 0, repaired: [] };

  let filled = 0;
  const repaired: string[] = [];

  const out = periods.map((period) => {
    const day = dayOf(period.endDate);
    if (!day) return period;

    // An exact end-date match first; only then the tolerant one, so a
    // neighbouring quarter can never win over the right one.
    const donor =
      donors.find((d) => d.endDate === day) ??
      donors.find(
        (d) => d.quarter === period.quarter && withinDays(d.endDate, day, SAME_PERIOD_DAYS),
      );
    if (!donor) return period;

    let touched = false;
    const merged: FinancialPeriod = { ...period };

    for (const field of fields) {
      if (merged[field] === null && donor[field] !== null) {
        (merged[field] as number | null) = donor[field];
        filled++;
        touched = true;
      }
    }

    if (touched) repaired.push(day);
    return merged;
  });

  return { periods: filled > 0 ? out : periods, filled, repaired };
}

/**
 * FMP's own total and net debt for a period, when it reported them.
 *
 * For cross-checking the derived figures in `research/statements`, not for
 * replacing them.
 */
export function reportedDebtFor(
  fmp: FmpBalanceSheets | null,
  endDate: string,
): { totalDebt: number | null; netDebt: number | null } | null {
  if (!fmp) return null;
  const day = dayOf(endDate);
  if (!day) return null;

  const exact = fmp.reportedDebt[day];
  if (exact) return exact;

  for (const [key, value] of Object.entries(fmp.reportedDebt)) {
    if (withinDays(key, day, SAME_PERIOD_DAYS)) return value;
  }
  return null;
}
