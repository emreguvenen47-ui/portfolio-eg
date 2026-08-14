import "server-only";
import type { FinancialPeriod } from "./fundamentals";
import { isBistSymbol, toBistYahoo } from "./bist";

/**
 * Financial statements for symbols the SEC path does not cover — Borsa
 * İstanbul in particular.
 *
 * Uses Yahoo's `quoteSummary` JSON, which is the same endpoint the Yahoo
 * Finance website itself calls. It requires the standard cookie-plus-crumb
 * handshake (a CSRF guard, not an entitlement), so that handshake is performed
 * once and the crumb reused.
 *
 * ONE CRITICAL DIFFERENCE FROM THE SEC PATH: these quarters are already
 * discrete. Verified against filed annuals — TUPRAŞ FY2025 revenue is ₺830.4bn
 * while its Q4 line reads ₺232.0bn, and Akbank's FY2025 ₺230.1bn against a Q4
 * of ₺67.3bn. Under a cumulative convention Q4 would equal the full year. So
 * the fiscal-year de-cumulation applied to 10-Q data must NOT be applied here;
 * doing so would subtract real quarters from each other and produce nonsense.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) PortfolioEG/1.0";
const TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 24 * 60 * 60_000;

const CACHE_KEY = Symbol.for("pcc.yahooFundamentals.cache");
const cache: Map<string, { at: number; value: YahooStatements | null }> = ((
  globalThis as unknown as Record<symbol, Map<string, { at: number; value: YahooStatements | null }>>
)[CACHE_KEY] ??= new Map());

const CRUMB_KEY = Symbol.for("pcc.yahooFundamentals.crumb");
const crumbCache = globalThis as unknown as Record<
  symbol,
  { at: number; crumb: string; cookie: string } | undefined
>;
const CRUMB_TTL_MS = 60 * 60_000;

/** Cookie-and-crumb handshake, reused for an hour. */
export async function getCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  const hit = crumbCache[CRUMB_KEY];
  if (hit && Date.now() - hit.at < CRUMB_TTL_MS) return hit;

  try {
    const seed = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": UA },
      cache: "no-store",
    });
    const raw = seed.headers.getSetCookie?.() ?? [];
    const cookie = raw.map((c) => c.split(";")[0]).join("; ");
    if (!cookie) return null;

    const res = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookie },
      cache: "no-store",
    });
    const crumb = (await res.text()).trim();
    if (!crumb || crumb.length > 32 || crumb.includes("<")) return null;

    const value = { crumb, cookie, at: Date.now() };
    crumbCache[CRUMB_KEY] = value;
    return value;
  } catch {
    return null;
  }
}

interface YNum {
  raw?: number;
}
type YRow = Record<string, YNum | { fmt?: string | null; raw?: number } | undefined> & {
  endDate?: { fmt?: string; raw?: number };
};

/**
 * Read a Yahoo money node.
 *
 * Yahoo emits `{raw: 0, fmt: null}` for a line the filer did not report — a
 * placeholder, not a zero. Turkish Airlines and Aselsan both return that for
 * gross profit, and taking it at face value rendered a confident "0.0% gross
 * margin" against companies that simply do not break the line out. A genuine
 * zero carries a formatted string, so an unformatted zero is treated as
 * absent.
 */
const n = (v: unknown): number | null => {
  const node = v as { raw?: number; fmt?: string | null } | undefined;
  const raw = node?.raw;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  if (raw === 0 && (node?.fmt === null || node?.fmt === undefined)) return null;
  return raw;
};

export interface YahooStatements {
  currency: string;
  quarterly: FinancialPeriod[];
  annual: FinancialPeriod[];
  asOf: string | null;
  source: string;
  sourceUrl: string;
}

const MODULES = [
  "incomeStatementHistory",
  "incomeStatementHistoryQuarterly",
  "balanceSheetHistory",
  "balanceSheetHistoryQuarterly",
  "cashflowStatementHistory",
  "cashflowStatementHistoryQuarterly",
  "price",
].join("%2C");

/** Merge the three statements for one period into the app's shape. */
function toPeriod(
  income: YRow | undefined,
  balance: YRow | undefined,
  cash: YRow | undefined,
  endDate: string,
  annual: boolean,
): FinancialPeriod {
  const [y, m] = endDate.split("-").map(Number);
  const ocf = n(cash?.totalCashFromOperatingActivities);
  const capex = n(cash?.capitalExpenditures);

  return {
    year: y,
    // Calendar quarter from the period end. BIST filers are on calendar years,
    // so this is the fiscal quarter too.
    quarter: annual ? 0 : Math.ceil(m / 3),
    endDate,
    // Already discrete — see the module comment. Never de-cumulated.
    discrete: true,

    revenue: n(income?.totalRevenue),
    costOfRevenue: n(income?.costOfRevenue),
    grossProfit: n(income?.grossProfit),
    rnd: n(income?.researchDevelopment),
    sga: n(income?.sellingGeneralAdministrative),
    operatingIncome: n(income?.operatingIncome),
    pretaxIncome: n(income?.incomeBeforeTax),
    taxExpense: n(income?.incomeTaxExpense),
    netIncome: n(income?.netIncome),
    eps: null,
    dilutedShares: null,

    operatingCashFlow: ocf,
    capex,
    freeCashFlow: ocf !== null && capex !== null ? ocf - Math.abs(capex) : null,
    depreciation: n(cash?.depreciation),
    stockComp: null,
    dividendsPaid: n(cash?.dividendsPaid),
    buybacks: n(cash?.repurchaseOfStock),
    stockIssued: n(cash?.issuanceOfStock),
    debtIssued: null,
    debtRepaid: null,

    cash: n(balance?.cash),
    shortTermInvestments: n(balance?.shortTermInvestments),
    totalAssets: n(balance?.totalAssets),
    currentAssets: n(balance?.totalCurrentAssets),
    currentLiabilities: n(balance?.totalCurrentLiabilities),
    totalLiabilities: n(balance?.totalLiab),
    equity: n(balance?.totalStockholderEquity),
    shortTermDebt: n(balance?.shortLongTermDebt),
    longTermDebt: n(balance?.longTermDebt),
    inventory: n(balance?.inventory),
  };
}

function build(
  incomes: YRow[],
  balances: YRow[],
  cashes: YRow[],
  annual: boolean,
): FinancialPeriod[] {
  const key = (r: YRow) => r.endDate?.fmt ?? "";
  const bMap = new Map(balances.map((b) => [key(b), b]));
  const cMap = new Map(cashes.map((c) => [key(c), c]));

  return incomes
    .map((inc) => {
      const d = key(inc);
      if (!d) return null;
      return toPeriod(inc, bMap.get(d), cMap.get(d), d, annual);
    })
    .filter((p): p is FinancialPeriod => p !== null)
    .sort((a, b) => b.endDate.localeCompare(a.endDate));
}

export async function getYahooStatements(symbol: string): Promise<YahooStatements | null> {
  const key = symbol.trim().toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const auth = await getCrumb();
  if (!auth) return null;

  const yahooSymbol = isBistSymbol(key) ? toBistYahoo(key) : key;
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSymbol)}?modules=${MODULES}&crumb=${encodeURIComponent(auth.crumb)}`;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      cache: "no-store",
      headers: { "User-Agent": UA, Cookie: auth.cookie },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      quoteSummary?: { result?: Record<string, unknown>[]; error?: unknown };
    };
    if (json.quoteSummary?.error || !json.quoteSummary?.result?.length) {
      throw new Error("no result");
    }
    const r = json.quoteSummary.result[0];

    const list = (mod: string, inner: string): YRow[] =>
      ((r[mod] as Record<string, YRow[]> | undefined)?.[inner] ?? []) as YRow[];

    const quarterly = build(
      list("incomeStatementHistoryQuarterly", "incomeStatementHistory"),
      list("balanceSheetHistoryQuarterly", "balanceSheetStatements"),
      list("cashflowStatementHistoryQuarterly", "cashflowStatements"),
      false,
    );
    const annual = build(
      list("incomeStatementHistory", "incomeStatementHistory"),
      list("balanceSheetHistory", "balanceSheetStatements"),
      list("cashflowStatementHistory", "cashflowStatements"),
      true,
    );

    if (quarterly.length === 0 && annual.length === 0) throw new Error("empty statements");

    const price = r.price as { currency?: string } | undefined;
    const value: YahooStatements = {
      currency: price?.currency ?? "TRY",
      quarterly,
      annual,
      asOf: quarterly[0]?.endDate ?? annual[0]?.endDate ?? null,
      source: "Yahoo Finance (company reported statements)",
      sourceUrl: `https://finance.yahoo.com/quote/${yahooSymbol}/financials`,
    };
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    cache.set(key, { at: Date.now(), value: null });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
