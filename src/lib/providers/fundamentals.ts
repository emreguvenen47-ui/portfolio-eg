import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { finnhubKey } from "./finnhub";

/**
 * Fundamentals: financials, valuation metrics, analyst recommendations,
 * earnings surprises and insider activity.
 *
 * All Finnhub free-tier endpoints. Anything the tier does not carry — price
 * targets, forward estimates, analyst actions, institutional ownership,
 * guidance — is reported as absent rather than filled in, because a fabricated
 * target price is worse than a blank cell.
 *
 * Cached for a day: fundamentals change quarterly, so re-fetching them on the
 * 120-second quote clock would be pure waste.
 */

const CACHE_TTL_MS = 24 * 60 * 60_000;
const CACHE_KEY = Symbol.for("pcc.fundamentals.cache");
const cache: Map<string, { at: number; value: unknown }> = ((
  globalThis as unknown as Record<symbol, Map<string, { at: number; value: unknown }>>
)[CACHE_KEY] ??= new Map());

/**
 * In-flight requests, so concurrent callers share one fetch.
 *
 * Without this, a page that mounts three panels needing the same company's
 * financials issues three identical calls, and a hundred users asking about
 * Apple in the same second issue a hundred. The cache only helps the ones that
 * arrive after the first has landed; this one helps the ones that arrive
 * during it.
 */
const FLIGHT_KEY = Symbol.for("pcc.fundamentals.inflight");
const inflight: Map<string, Promise<unknown>> = ((
  globalThis as unknown as Record<symbol, Map<string, Promise<unknown>>>
)[FLIGHT_KEY] ??= new Map());

async function cached<T>(key: string, load: () => Promise<T>): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;

  const running = inflight.get(key) as Promise<T | null> | undefined;
  if (running) return running;

  const p = (async () => {
    try {
      const value = await load();
      cache.set(key, { at: Date.now(), value });
      return value;
    } catch {
      // Serve the previous pull rather than blanking a page on one blip.
      return (hit?.value as T) ?? null;
    }
  })().finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}

/**
 * Pace requests to the free tier's published allowance.
 *
 * Bulk work — warming a screener pool — fires hundreds of calls in seconds and
 * the tier answers roughly two in five with a 429. Those failures used to
 * surface as null fundamentals, which is indistinguishable from "this company
 * does not report it". Spacing the calls turns a coverage problem back into
 * the data question it actually is.
 *
 * A token bucket over a rolling minute, plus a small concurrency cap so a
 * burst cannot all leave at once.
 */
const LIMIT_KEY = Symbol.for("pcc.finnhub.limiter");
interface LimiterState {
  window: number[];
  active: number;
  foregroundWaiting: number;
  /** When a foreground call last took a slot. */
  lastForegroundAt: number;
}

const limiter: LimiterState = ((globalThis as unknown as Record<symbol, LimiterState>)[
  LIMIT_KEY
] ??= { window: [], active: 0, foregroundWaiting: 0, lastForegroundAt: 0 });

/**
 * Which requests may take a slot while somebody is waiting on a page.
 *
 * The background sweep assembles the whole listing, which means it always has
 * work and will always be asking. Sharing one FIFO queue with page requests
 * let it hold every slot: a ticker page for a company nobody had viewed went
 * from under five seconds to thirty-five, because the user's four calls sat
 * behind the sweep's.
 *
 * So the sweep yields. It is marked background through this store, and it
 * waits while any foreground call is queued. Nothing is dropped — the sweep
 * simply runs in the gaps, which is what a background task is for.
 */
const backgroundFlag = new AsyncLocalStorage<boolean>();

/** Run `fn` with its provider calls marked as background work. */
export const asBackground = <T>(fn: () => Promise<T>): Promise<T> =>
  backgroundFlag.run(true, fn);

const isBackground = (): boolean => backgroundFlag.getStore() === true;

/** Upstream calls actually issued, for the status probe and for benchmarking. */
const COUNT_KEY = Symbol.for("pcc.finnhub.calls");
const counter: { n: number } = ((globalThis as unknown as Record<symbol, { n: number }>)[
  COUNT_KEY
] ??= { n: 0 });

export const upstreamCallCount = (): number => counter.n;

const PER_MINUTE = 55;
const MAX_CONCURRENT = 5;

/**
 * The share of the minute background work may consume.
 *
 * Yielding the concurrency slot was not enough on its own: the sweep always
 * has work, so it kept the rolling window full and a page request waited for
 * the window to roll rather than for a slot — a cold ticker page measured 23
 * to 35 seconds with the sweep running. Reserving the difference means a
 * person's six or seven calls always have somewhere to go.
 */
const BACKGROUND_PER_MINUTE = 28;

/**
 * How long the sweep stands down after a page request touches the provider.
 *
 * A budget alone still let the two interleave, and a page needing seven calls
 * could find the window filled between its own. While somebody is actively
 * moving around the app the sweep simply stops; it resumes a few seconds after
 * they go quiet. Coverage is a background concern and can wait, a page cannot.
 */
const QUIET_AFTER_FOREGROUND_MS = 4_000;
/**
 * A hung connection must not hold a queue slot open forever. Fifteen seconds
 * is well past this endpoint's normal response and well short of a user
 * noticing a stall.
 */
const TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function acquire(): Promise<void> {
  const background = isBackground();
  if (!background) limiter.foregroundWaiting++;

  try {
    for (;;) {
      const now = Date.now();
      limiter.window = limiter.window.filter((t) => now - t < 60_000);

      const budget = background ? BACKGROUND_PER_MINUTE : PER_MINUTE;
      const hasRoom = limiter.window.length < budget && limiter.active < MAX_CONCURRENT;
      // Background work also steps aside for anything a person is waiting on,
      // and leaves a concurrency slot spare so a foreground call arriving
      // mid-flight is not stuck behind a full window.
      const quiet = now - limiter.lastForegroundAt > QUIET_AFTER_FOREGROUND_MS;
      const mayGo = background
        ? hasRoom &&
          quiet &&
          limiter.foregroundWaiting === 0 &&
          limiter.active < MAX_CONCURRENT - 1
        : hasRoom;

      if (mayGo) {
        limiter.window.push(now);
        limiter.active++;
        if (!background) limiter.lastForegroundAt = now;
        return;
      }

      const oldest = limiter.window[0];
      const wait =
        limiter.window.length >= PER_MINUTE
          ? Math.max(50, 60_000 - (now - oldest))
          : background
            ? 250
            : 40;
      await sleep(Math.min(wait, 2_000));
    }
  } finally {
    if (!background) limiter.foregroundWaiting--;
  }
}

async function call<T>(path: string): Promise<T> {
  const token = finnhubKey();
  if (!token) throw new Error("FINNHUB_API_KEY not configured");

  let res: Response;
  for (let attempt = 0; ; attempt++) {
    await acquire();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    counter.n++;
    try {
      res = await fetch(`https://finnhub.io/api/v1${path}&token=${token}`, {
        cache: "no-store",
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(timer);
      limiter.active--;
    }
    // A 429 means we were early, not that the data is missing. Back off and
    // ask again rather than reporting the company as uncovered.
    if (res.status !== 429 || attempt >= 3) break;
    await sleep(1_500 * (attempt + 1));
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as T & { error?: string };
  if (json && typeof json === "object" && "error" in json && json.error) {
    throw new Error(String(json.error));
  }
  return json;
}

// ------------------------------------------------------------------ metrics

export interface KeyMetrics {
  peTTM?: number;
  forwardPE?: number;
  pegTTM?: number;
  forwardPEG?: number;
  pbQuarterly?: number;
  psTTM?: number;
  pfcfShareTTM?: number;
  evEbitdaTTM?: number;
  evRevenueTTM?: number;
  enterpriseValue?: number;
  currentEv?: number;
  "currentEv/freeCashFlowTTM"?: number;
  "52WeekHigh"?: number;
  "52WeekLow"?: number;
  grossMarginTTM?: number;
  operatingMarginTTM?: number;
  netProfitMarginTTM?: number;
  grossMarginAnnual?: number;
  operatingMarginAnnual?: number;
  roeTTM?: number;
  roaTTM?: number;
  revenueGrowthTTMYoy?: number;
  revenueGrowthQuarterlyYoy?: number;
  epsGrowthTTMYoy?: number;
  epsGrowthQuarterlyYoy?: number;
  currentRatioQuarterly?: number;
  quickRatioQuarterly?: number;
  /** Note the slash: Finnhub's own key name, not a typo. */
  "totalDebt/totalEquityQuarterly"?: number;
  "longTermDebt/equityQuarterly"?: number;
  netInterestCoverageTTM?: number;
  bookValuePerShareQuarterly?: number;
  revenuePerShareTTM?: number;
  payoutRatioTTM?: number;
  dividendYieldIndicatedAnnual?: number;
  beta?: number;
  [k: string]: number | string | undefined;
}

export const getMetrics = (symbol: string) =>
  cached<KeyMetrics>(`metric:${symbol}`, async () => {
    const r = await call<{ metric?: KeyMetrics }>(`/stock/metric?symbol=${symbol}&metric=all`);
    return r.metric ?? {};
  });

// ------------------------------------------------------------------ profile

export interface CompanyProfile {
  name?: string;
  ticker?: string;
  exchange?: string;
  finnhubIndustry?: string;
  country?: string;
  currency?: string;
  /** Millions of the reporting currency, as Finnhub returns it. */
  marketCapitalization?: number;
  shareOutstanding?: number;
  ipo?: string;
  weburl?: string;
}

export const getProfile = (symbol: string) =>
  cached<CompanyProfile>(`prof:${symbol}`, () =>
    call<CompanyProfile>(`/stock/profile2?symbol=${symbol}`),
  );

// ---------------------------------------------------------- recommendations

export interface Recommendation {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

export const getRecommendations = (symbol: string) =>
  cached<Recommendation[]>(`rec:${symbol}`, () =>
    call<Recommendation[]>(`/stock/recommendation?symbol=${symbol}`),
  );

// --------------------------------------------------------------- earnings

export interface EarningsPoint {
  period: string;
  actual: number | null;
  estimate: number | null;
  surprise: number | null;
  surprisePercent: number | null;
}

export const getEarnings = (symbol: string) =>
  cached<EarningsPoint[]>(`earn:${symbol}`, () =>
    call<EarningsPoint[]>(`/stock/earnings?symbol=${symbol}`),
  );

// -------------------------------------------------------------- financials

/** One reported line item, as Finnhub returns it. */
interface ReportedItem {
  concept?: string;
  label?: string;
  value?: number;
}

export interface FinancialPeriod {
  year: number;
  /** 0 for an annual period, 1..4 for a quarter. */
  quarter: number;
  endDate: string;
  /** True when flow figures are discrete rather than fiscal-year-to-date. */
  discrete: boolean;

  // income
  revenue: number | null;
  costOfRevenue: number | null;
  grossProfit: number | null;
  rnd: number | null;
  sga: number | null;
  operatingIncome: number | null;
  pretaxIncome: number | null;
  taxExpense: number | null;
  netIncome: number | null;
  eps: number | null;
  dilutedShares: number | null;

  // cash flow
  operatingCashFlow: number | null;
  capex: number | null;
  freeCashFlow: number | null;
  depreciation: number | null;
  stockComp: number | null;
  dividendsPaid: number | null;
  buybacks: number | null;
  stockIssued: number | null;
  debtIssued: number | null;
  debtRepaid: number | null;

  // balance sheet (point in time — never cumulative)
  cash: number | null;
  shortTermInvestments: number | null;
  totalAssets: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  totalLiabilities: number | null;
  equity: number | null;
  shortTermDebt: number | null;
  longTermDebt: number | null;
  inventory: number | null;
}

/**
 * Pull a line item by trying several XBRL concepts.
 *
 * Two things make this harder than a lookup. Concepts arrive namespaced
 * (`us-gaap_GrossProfit`, or `aapl_...` for company extensions), so matching
 * has to be on the suffix. And filers tag the same economic line differently —
 * `Revenues` vs `RevenueFromContractWithCustomerExcludingAssessedTax` vs a
 * bank's `RevenuesNetOfInterestExpense` — so a single concept name silently
 * returns null for perfectly normal companies.
 */
function pick(items: ReportedItem[], concepts: string[]): number | null {
  for (const c of concepts) {
    const hit = items.find(
      (i) =>
        typeof i.value === "number" &&
        (i.concept === c || (i.concept?.endsWith(`_${c}`) ?? false)),
    );
    if (hit) return hit.value!;
  }
  return null;
}

/** Same lookup, across several statements in order of preference. */
function pickAcross(groups: ReportedItem[][], concepts: string[]): number | null {
  for (const g of groups) {
    const v = pick(g, concepts);
    if (v !== null) return v;
  }
  return null;
}

/**
 * Depreciation & amortisation, which filers tag in five incompatible ways.
 *
 * Observed across mid-cap industrials: EMCOR and Applied Industrial post
 * `Depreciation` and `AmortizationOfIntangibleAssets` as two separate
 * cash-flow add-backs; EnerSys posts a single `DepreciationAndAmortization`;
 * Mueller and Boise Cascade put the combined line on the income statement and
 * only a partial or company-extension line in the cash-flow statement.
 *
 * Reading only the combined cash-flow concepts returned null for most of them,
 * which silently emptied EBITDA — and with it EV/EBITDA — for the majority of
 * small and mid caps. So: prefer a combined line wherever it is filed, and
 * fall back to summing the separately filed components.
 *
 * The components are summed, never assumed. The cash-flow reconciliation lists
 * non-cash add-backs exhaustively, so what is absent from it was not charged;
 * a company reporting depreciation and no intangible amortisation has none.
 * If neither a combined line nor any component is filed, this stays null.
 */
const DA_COMBINED = [
  "DepreciationDepletionAndAmortization",
  "DepreciationAndAmortization",
  "DepreciationAmortizationAndAccretionNet",
  "DepreciationDepletionAndAmortizationExcludingAmortizationOfDeferredCharges",
];

const DA_COMPONENTS = [
  ["Depreciation", "DepreciationNonproduction"],
  ["AmortizationOfIntangibleAssets", "AmortizationOfIntangibleAssetsExcludingFinancing"],
];

function depreciationAndAmortisation(cf: ReportedItem[], ic: ReportedItem[]): number | null {
  const combined = pickAcross([cf, ic], DA_COMBINED);
  if (combined !== null) return combined;

  let sum: number | null = null;
  for (const concepts of DA_COMPONENTS) {
    const v = pickAcross([cf, ic], concepts);
    if (v !== null) sum = (sum ?? 0) + v;
  }
  return sum;
}

const REVENUE = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "Revenues",
  "SalesRevenueNet",
  // Banks report revenue net of interest expense; without this a financial
  // stock shows a blank income statement.
  "RevenuesNetOfInterestExpense",
  "InterestAndDividendIncomeOperating",
];

function parsePeriod(p: {
  year: number;
  quarter: number;
  endDate: string;
  report?: { ic?: ReportedItem[]; bs?: ReportedItem[]; cf?: ReportedItem[] };
}): FinancialPeriod {
  const ic = p.report?.ic ?? [];
  const bs = p.report?.bs ?? [];
  const cf = p.report?.cf ?? [];

  const ocf = pick(cf, [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
  ]);
  const capex = pick(cf, [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
    "PaymentsForCapitalImprovements",
  ]);

  return {
    year: p.year,
    quarter: p.quarter,
    endDate: p.endDate,
    discrete: false,

    revenue: pick(ic, REVENUE),
    costOfRevenue: pick(ic, ["CostOfGoodsAndServicesSold", "CostOfRevenue", "CostOfSales"]),
    grossProfit: pick(ic, ["GrossProfit"]),
    rnd: pick(ic, ["ResearchAndDevelopmentExpense"]),
    sga: pick(ic, [
      "SellingGeneralAndAdministrativeExpense",
      "GeneralAndAdministrativeExpense",
    ]),
    operatingIncome: pick(ic, ["OperatingIncomeLoss"]),
    pretaxIncome: pick(ic, [
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    ]),
    taxExpense: pick(ic, ["IncomeTaxExpenseBenefit"]),
    netIncome: pick(ic, ["NetIncomeLoss", "ProfitLoss"]),
    eps: pick(ic, ["EarningsPerShareDiluted", "EarningsPerShareBasic"]),
    dilutedShares: pick(ic, [
      "WeightedAverageNumberOfDilutedSharesOutstanding",
      "WeightedAverageNumberOfSharesOutstandingBasic",
    ]),

    operatingCashFlow: ocf,
    capex,
    freeCashFlow: ocf !== null && capex !== null ? ocf - Math.abs(capex) : null,
    depreciation: depreciationAndAmortisation(cf, ic),
    stockComp: pick(cf, ["ShareBasedCompensation"]),
    dividendsPaid: pick(cf, [
      "PaymentsOfDividends",
      "PaymentsOfDividendsCommonStock",
      "PaymentsOfOrdinaryDividends",
    ]),
    buybacks: pick(cf, [
      "PaymentsForRepurchaseOfCommonStock",
      "PaymentsForRepurchaseOfEquity",
    ]),
    stockIssued: pick(cf, [
      "ProceedsFromIssuanceOfCommonStock",
      "ProceedsFromStockOptionsExercised",
    ]),
    debtIssued: pick(cf, [
      "ProceedsFromIssuanceOfLongTermDebt",
      "ProceedsFromIssuanceOfSeniorLongTermDebt",
    ]),
    debtRepaid: pick(cf, ["RepaymentsOfLongTermDebt", "RepaymentsOfDebt"]),

    cash: pick(bs, [
      "CashAndCashEquivalentsAtCarryingValue",
      "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
      "CashAndCashEquivalentsAtCarryingValueIncludingDiscontinuedOperations",
      // Combined line, tried last: a filer that presents cash and short-term
      // investments as one figure files no separate investments line, so the
      // `shortTermInvestments` add below stays null and nothing is counted
      // twice.
      "CashCashEquivalentsAndShortTermInvestments",
    ]),
    shortTermInvestments: pick(bs, ["MarketableSecuritiesCurrent", "ShortTermInvestments"]),
    totalAssets: pick(bs, ["Assets"]),
    currentAssets: pick(bs, ["AssetsCurrent"]),
    currentLiabilities: pick(bs, ["LiabilitiesCurrent"]),
    totalLiabilities: pick(bs, ["Liabilities"]),
    equity: pick(bs, [
      "StockholdersEquity",
      "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ]),
    // Filers split borrowings across a wide set of tags, and reading only the
    // two plainest ones left leverage — and with it ROIC and net debt — blank
    // for companies that simply worded their balance sheet differently.
    shortTermDebt: pick(bs, [
      "LongTermDebtCurrent",
      "LongTermDebtAndCapitalLeaseObligationsCurrent",
      "FinanceLeaseLiabilityCurrent",
      "CommercialPaper",
      "ShortTermBorrowings",
      "NotesPayableCurrent",
      "LinesOfCreditCurrent",
      "DebtCurrent",
    ]),
    longTermDebt: pick(bs, [
      "LongTermDebtNoncurrent",
      "LongTermDebtAndCapitalLeaseObligations",
      "LongTermDebtAndCapitalLeaseObligationsNoncurrent",
      "LongTermDebt",
      "LongTermNotesPayable",
      "SecuredLongTermDebt",
      "UnsecuredLongTermDebt",
      "DebtLongtermAndShorttermCombinedAmount",
    ]),
    inventory: pick(bs, ["InventoryNet"]),
  };
}

/** Flow lines are cumulative within a fiscal year; balance lines are not. */
const FLOW_KEYS = [
  "revenue",
  "costOfRevenue",
  "grossProfit",
  "rnd",
  "sga",
  "operatingIncome",
  "pretaxIncome",
  "taxExpense",
  "netIncome",
  // EPS is cumulative too: Apple's Q2 FY2026 line reads 4.85 for six months,
  // and 4.85 − 2.84 = 2.01, which is exactly discrete net income over the
  // period's share count. `dilutedShares` is deliberately NOT in this list —
  // it is a weighted average for each period, not a running total.
  "eps",
  "operatingCashFlow",
  "capex",
  "freeCashFlow",
  "depreciation",
  "stockComp",
  "dividendsPaid",
  "buybacks",
  "stockIssued",
  "debtIssued",
  "debtRepaid",
] as const satisfies readonly (keyof FinancialPeriod)[];

/**
 * Turn fiscal-year-to-date figures into discrete quarters.
 *
 * A 10-Q reports the year so far, not the quarter: Apple's Q2 FY2025 revenue
 * line reads $219.7bn because it covers two quarters. Charting those raw
 * produces a sawtooth that resets every fiscal year and a "QoQ" number that is
 * meaningless. Each quarter after the first therefore has the prior quarter's
 * cumulative value subtracted.
 *
 * The diluted share count is left alone: it is a weighted average for each
 * period rather than a running total, so subtracting it would be wrong.
 *
 * A quarter whose predecessor is missing stays cumulative and is marked
 * `discrete: false`, so the UI can leave it out rather than plot a spike.
 */
function decumulate(periods: FinancialPeriod[]): FinancialPeriod[] {
  const byKey = new Map(periods.map((p) => [`${p.year}-${p.quarter}`, p]));

  return periods.map((p) => {
    if (p.quarter <= 1) return { ...p, discrete: true };
    const prior = byKey.get(`${p.year}-${p.quarter - 1}`);
    if (!prior) return p;

    const out: FinancialPeriod = { ...p, discrete: true };
    for (const k of FLOW_KEYS) {
      const cur = p[k];
      const prev = prior[k];
      // Both legs must be present: subtracting from a missing prior quarter
      // would silently report the year-to-date figure as one quarter.
      (out[k] as number | null) =
        typeof cur === "number" && typeof prev === "number" ? cur - prev : null;
    }
    out.freeCashFlow =
      out.operatingCashFlow !== null && out.capex !== null
        ? out.operatingCashFlow - Math.abs(out.capex)
        : null;
    return out;
  });
}

/**
 * Quarterly statements, de-cumulated, newest first.
 *
 * Finnhub's quarterly feed omits Q4 — the fourth quarter only ever appears
 * inside the 10-K — so the annual series is pulled too and Q4 is derived as
 * (full year − Q3 year-to-date). Without that every fiscal year shows a hole.
 */
export const getFinancials = (symbol: string) =>
  cached<FinancialPeriod[]>(`fin:${symbol}`, async () => {
    const [q, a] = await Promise.all([
      call<{ data?: Parameters<typeof parsePeriod>[0][] }>(
        `/stock/financials-reported?symbol=${symbol}&freq=quarterly`,
      ),
      call<{ data?: Parameters<typeof parsePeriod>[0][] }>(
        `/stock/financials-reported?symbol=${symbol}&freq=annual`,
      ).catch(() => ({ data: [] as Parameters<typeof parsePeriod>[0][] })),
    ]);

    const raw = (q.data ?? []).slice(0, 16).map(parsePeriod);
    const annual = (a.data ?? []).slice(0, 6).map(parsePeriod);
    const quarters = decumulate(raw);

    // Derive Q4 from the annual report where the year is complete.
    const q4s: FinancialPeriod[] = [];
    for (const fy of annual) {
      const q3 = raw.find((p) => p.year === fy.year && p.quarter === 3);
      if (!q3) continue;
      if (quarters.some((p) => p.year === fy.year && p.quarter === 4)) continue;

      const out: FinancialPeriod = { ...fy, quarter: 4, discrete: true };
      for (const k of FLOW_KEYS) {
        const full = fy[k];
        const ytd = q3[k];
        (out[k] as number | null) =
          typeof full === "number" && typeof ytd === "number" ? full - ytd : null;
      }
      out.freeCashFlow =
        out.operatingCashFlow !== null && out.capex !== null
          ? out.operatingCashFlow - Math.abs(out.capex)
          : null;
      q4s.push(out);
    }

    return [...quarters, ...q4s].sort((x, y) =>
      y.year !== x.year ? y.year - x.year : y.quarter - x.quarter,
    );
  });

/** Annual statements, newest first. Already discrete — a fiscal year is whole. */
export const getAnnualFinancials = (symbol: string) =>
  cached<FinancialPeriod[]>(`finA:${symbol}`, async () => {
    const r = await call<{ data?: Parameters<typeof parsePeriod>[0][] }>(
      `/stock/financials-reported?symbol=${symbol}&freq=annual`,
    );
    return (r.data ?? [])
      .slice(0, 8)
      .map((p) => ({ ...parsePeriod(p), quarter: 0, discrete: true }));
  });

// ----------------------------------------------------------------- insider

export interface InsiderTx {
  name: string;
  /** Shares held after the transaction, as reported on the Form 4. */
  share: number;
  /** Signed share delta: negative is a disposal. */
  change: number;
  filingDate: string;
  transactionDate: string;
  transactionPrice: number;
  /** SEC Form 4 transaction code — P, S, A, M, F, G and friends. */
  transactionCode?: string;
  isDerivative?: boolean;
  currency?: string;
  id?: string;
}

export const getInsiders = (symbol: string) =>
  cached<InsiderTx[]>(`ins:${symbol}`, async () => {
    const r = await call<{ data?: InsiderTx[] }>(`/stock/insider-transactions?symbol=${symbol}`);
    // Keep a full year or so of filings: the 30/90/365-day summaries and the
    // cluster detector need the history, not just the latest page.
    return (r.data ?? []).slice(0, 250);
  });
