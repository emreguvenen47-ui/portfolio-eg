import "server-only";
import { diskCache } from "@/lib/server/disk-cache";
import { getScreenerUniverse, type ScreenerRow } from "./eodhd/screener";
import { getCompanySnapshot } from "./eodhd/fundamentals";
import { createEodhdProvider } from "@/lib/providers/eodhd";
import { buildTechnicalDecision } from "@/lib/engines/technical-v3";
import { computeValuation } from "@/lib/engines/valuation";
import { computeExpectations } from "@/lib/engines/expectations";

/**
 * Precomputed Opportunity/Screener Universe (spec §38–43, v3).
 *
 * ONE canonical table backs both pages. The FULL universe is computed by the
 * bulk sweep (scripts — run in background/scheduled), stored as a single
 * array; page opens and filters are pure in-memory reads over that array.
 * No provider call, no engine run, ever happens on a user filter.
 */

export interface OpportunitySnapshot {
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  price: number | null;

  peTtm: number | null;
  forwardPe: number | null;
  priceToBook: number | null;
  evToEbitda: number | null;
  fcfYield: number | null;
  roe: number | null;
  revenueGrowthYoY: number | null;
  epsGrowthYoY: number | null;
  netMarginTtm: number | null;
  netDebtToEbitda: number | null;

  fairValue: number | null;
  upsidePct: number | null;
  valuationConfidence: string | null;

  revisionScore: number | null;
  expectationGapPct: number | null;

  technicalScore: number | null;
  technicalSignal: string | null;
  setupType: string | null;
  signalFreshness: string | null;
  weeklyRegime: string | null;
  primarySupport: number | null;
  primaryResistance: number | null;
  standardStop: number | null;
  target1: number | null;
  riskReward: number | null;
  distanceToSupportPct: number | null;

  egSetupScore: number | null;
  scoreParts: string[];

  updatedAt: string;
}

const rowsStore = diskCache<OpportunitySnapshot[]>("opportunity-universe-v3", 36 * 60 * 60_000);
const ROWS_KEY = "rows";

function egSetupScore(o: Omit<OpportunitySnapshot, "egSetupScore" | "scoreParts" | "updatedAt">): {
  score: number | null;
  parts: string[];
} {
  const parts: string[] = [];
  const comp: Array<[number, number]> = [];
  if (o.upsidePct !== null) {
    comp.push([Math.max(0, Math.min(1, 0.5 + o.upsidePct / 60)), 0.3]);
    parts.push(`${o.upsidePct > 0 ? "+" : ""}${o.upsidePct.toFixed(0)}% fair-value ${o.upsidePct >= 0 ? "upside" : "downside"}`);
  }
  if (o.revisionScore !== null) {
    comp.push([o.revisionScore / 100, 0.2]);
    parts.push(`Revision score ${o.revisionScore}/100`);
  }
  if (o.expectationGapPct !== null) {
    comp.push([Math.max(0, Math.min(1, 0.5 + o.expectationGapPct / 40)), 0.15]);
  }
  if (o.technicalScore !== null) {
    comp.push([o.technicalScore / 100, 0.25]);
    parts.push(`Technical ${o.technicalScore}/100${o.setupType && o.setupType !== "NONE" ? ` (${o.setupType.replaceAll("_", " ").toLowerCase()})` : ""}`);
  }
  if (o.riskReward !== null) {
    comp.push([Math.max(0, Math.min(1, o.riskReward / 4)), 0.1]);
    parts.push(`R:R ${o.riskReward}`);
  }
  if (comp.length < 3) return { score: null, parts: [] };
  const wsum = comp.reduce((a, [, w]) => a + w, 0);
  return { score: Math.round(comp.reduce((a, [v, w]) => a + v * (w / wsum), 0) * 100), parts };
}

/** Deep row for one symbol. Exposed for the bulk sweep script. */
export async function computeOpportunityRow(row: ScreenerRow): Promise<OpportunitySnapshot | null> {
  const symbol = row.symbol;
  const [snapshot, hist] = await Promise.all([
    getCompanySnapshot(symbol).catch(() => null),
    createEodhdProvider().getHistoricalPrices(symbol, { outputsize: 420 }).catch(() => null),
  ]);
  if (!snapshot || !hist || hist.candles.length < 60) return null;
  const price = hist.candles.at(-1)!.close;
  const d = buildTechnicalDecision(symbol, hist.candles);
  const v = computeValuation(snapshot, price);
  const fairMult = typeof v.assumptions.fwdMultiple === "number" ? v.assumptions.fwdMultiple : null;
  const e = computeExpectations(snapshot, price, fairMult);
  const stdStop = d.stops.find((s) => s.kind === "STANDARD") ?? d.stops[0] ?? null;

  const core = {
    symbol,
    name: snapshot.identity.name ?? row.name,
    sector: snapshot.identity.sector ?? row.sector,
    industry: snapshot.identity.industry ?? row.industry,
    marketCap: snapshot.marketCap ?? row.marketCap,
    price,
    peTtm: snapshot.peTtm,
    forwardPe: snapshot.forwardPe,
    priceToBook: snapshot.priceToBook,
    evToEbitda: snapshot.evToEbitda,
    fcfYield: snapshot.fcfYield,
    roe: snapshot.roe,
    revenueGrowthYoY: snapshot.revenueGrowthYoY,
    epsGrowthYoY: snapshot.epsGrowthYoY,
    netMarginTtm: snapshot.netMarginTtm,
    netDebtToEbitda: snapshot.netDebtToEbitda,
    fairValue: v.verdict === "OK" ? v.base : null,
    upsidePct: v.verdict === "OK" ? v.upsidePct : null,
    valuationConfidence: v.verdict === "OK" ? v.confidence : "INVALID",
    revisionScore: e.revisionScore,
    expectationGapPct: e.expectationGapPct,
    technicalScore: d.score?.total ?? null,
    technicalSignal: d.signal,
    setupType: d.setup,
    signalFreshness: d.freshness,
    weeklyRegime: d.weeklyTrend,
    primarySupport: d.daily.primarySupport,
    primaryResistance: d.daily.primaryResistance,
    standardStop: stdStop?.price ?? null,
    target1: d.target1,
    riskReward: d.riskReward,
    distanceToSupportPct:
      d.daily.primarySupport !== null && price > 0
        ? Number((((price - d.daily.primarySupport) / price) * 100).toFixed(1))
        : null,
  };
  const { score, parts } = egSetupScore(core);
  return { ...core, egSetupScore: score, scoreParts: parts, updatedAt: new Date().toISOString() };
}

/** Merge freshly computed rows into the canonical table (by symbol). */
export function upsertOpportunityRows(newRows: OpportunitySnapshot[]): number {
  const existing = rowsStore.get(ROWS_KEY) ?? [];
  const bySymbol = new Map(existing.map((r) => [r.symbol, r]));
  for (const r of newRows) bySymbol.set(r.symbol, r);
  const merged = [...bySymbol.values()].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
  rowsStore.set(ROWS_KEY, merged);
  rowsStore.flushNow();
  void persistUniverseToSupabase(merged);
  return merged.length;
}

export function getUniverseRows(): OpportunitySnapshot[] {
  const rows = rowsStore.get(ROWS_KEY) ?? [];
  if (rows.length === 0) void hydrateUniverseFromSupabase();
  return rows;
}

// ---------------------------------------------------- production-safe store
//
// The disk store is the hot path (sync, in-process). When Supabase is
// configured the table is ALSO written through to `universe_snapshot`, and a
// cold boot with an empty disk hydrates from it — so a fresh deploy or a
// wiped container starts from the last successful snapshot instead of an
// empty universe. Missing table → silent fallback to disk (setup state).

let hydrating = false;
async function hydrateUniverseFromSupabase(): Promise<void> {
  if (hydrating) return;
  hydrating = true;
  try {
    const { getSupabaseAdmin, isMissingTable } = await import("@/lib/server/supabase");
    const sb = getSupabaseAdmin();
    if (!sb) return;
    const { data, error } = await sb
      .from("universe_snapshot")
      .select("rows")
      .eq("id", "canonical")
      .maybeSingle();
    if (error) {
      if (!isMissingTable(error)) console.error("[universe] supabase hydrate failed:", error.message);
      return;
    }
    const rows = (data?.rows ?? []) as OpportunitySnapshot[];
    if (rows.length && (rowsStore.get(ROWS_KEY) ?? []).length === 0) {
      rowsStore.set(ROWS_KEY, rows);
      rowsStore.flushNow();
      console.log(`[universe] hydrated ${rows.length} rows from Supabase`);
    }
  } catch {
    /* optional store — disk remains authoritative */
  } finally {
    hydrating = false;
  }
}

async function persistUniverseToSupabase(rows: OpportunitySnapshot[]): Promise<void> {
  try {
    const { getSupabaseAdmin, isMissingTable } = await import("@/lib/server/supabase");
    const sb = getSupabaseAdmin();
    if (!sb) return;
    const { error } = await sb.from("universe_snapshot").upsert({
      id: "canonical",
      rows,
      row_count: rows.length,
      updated_at: new Date().toISOString(),
    });
    if (error && !isMissingTable(error)) console.error("[universe] supabase persist failed:", error.message);
  } catch {
    /* never let the optional store break the hot path */
  }
}

export function getUniverseMeta(): { rows: number; oldest: string | null; newest: string | null } {
  const rows = getUniverseRows();
  if (rows.length === 0) return { rows: 0, oldest: null, newest: null };
  let oldest = rows[0]!.updatedAt;
  let newest = rows[0]!.updatedAt;
  for (const r of rows) {
    if (r.updatedAt < oldest) oldest = r.updatedAt;
    if (r.updatedAt > newest) newest = r.updatedAt;
  }
  return { rows: rows.length, oldest, newest };
}

// ------------------------------------------------------------------- queries

export interface OpportunityView {
  key: string;
  label: string;
  filter: (o: OpportunitySnapshot) => boolean;
  sort: (a: OpportunitySnapshot, b: OpportunitySnapshot) => number;
}

const byScore = (a: OpportunitySnapshot, b: OpportunitySnapshot) =>
  (b.egSetupScore ?? -1) - (a.egSetupScore ?? -1);

export const OPPORTUNITY_VIEWS: OpportunityView[] = [
  { key: "best", label: "BEST OVERALL", filter: (o) => o.egSetupScore !== null, sort: byScore },
  { key: "deep-value", label: "DEEP VALUE", filter: (o) => (o.upsidePct ?? -1) > 25 && o.valuationConfidence === "HIGH", sort: (a, b) => (b.upsidePct ?? 0) - (a.upsidePct ?? 0) },
  { key: "quality-growth", label: "QUALITY GROWTH", filter: (o) => (o.revenueGrowthYoY ?? 0) > 0.12 && (o.roe ?? 0) > 0.15 && (o.netMarginTtm ?? 0) > 0.1, sort: byScore },
  { key: "revisions", label: "POSITIVE REVISIONS", filter: (o) => (o.revisionScore ?? 0) >= 70, sort: (a, b) => (b.revisionScore ?? 0) - (a.revisionScore ?? 0) },
  { key: "gap", label: "HIGH EXPECTATION GAP", filter: (o) => (o.expectationGapPct ?? -999) > 10, sort: (a, b) => (b.expectationGapPct ?? 0) - (a.expectationGapPct ?? 0) },
  { key: "near-support", label: "NEAR SUPPORT", filter: (o) => o.distanceToSupportPct !== null && o.distanceToSupportPct >= 0 && o.distanceToSupportPct <= 4 && (o.technicalScore ?? 0) >= 50, sort: (a, b) => (a.distanceToSupportPct ?? 99) - (b.distanceToSupportPct ?? 99) },
  { key: "breakout", label: "BREAKOUT CANDIDATES", filter: (o) => o.technicalSignal === "BREAKOUT_PENDING" || o.setupType === "BREAKOUT" || o.setupType === "BREAKOUT_RETEST", sort: byScore },
  { key: "rr", label: "HIGH RISK/REWARD", filter: (o) => (o.riskReward ?? 0) >= 2, sort: (a, b) => (b.riskReward ?? 0) - (a.riskReward ?? 0) },
  {
    key: "contrarian",
    label: "CONTRARIAN",
    // Cheap on the models while the tape is against it: high fair-value upside
    // with a weak weekly regime or beaten-down technical score.
    filter: (o) =>
      (o.upsidePct ?? -999) > 20 &&
      o.valuationConfidence !== "INVALID" &&
      ((o.weeklyRegime ?? "").includes("DOWN") || (o.technicalScore ?? 100) < 40),
    sort: (a, b) => (b.upsidePct ?? 0) - (a.upsidePct ?? 0),
  },
];

export function getOpportunities(viewKey: string, limit = 50): {
  rows: OpportunitySnapshot[];
  coverage: { deepRows: number; newest: string | null; oldest: string | null };
} {
  const view = OPPORTUNITY_VIEWS.find((v) => v.key === viewKey) ?? OPPORTUNITY_VIEWS[0]!;
  const all = getUniverseRows();
  const meta = getUniverseMeta();
  return {
    rows: all.filter(view.filter).sort(view.sort).slice(0, limit),
    coverage: { deepRows: meta.rows, newest: meta.newest, oldest: meta.oldest },
  };
}

// ------------------------------------------------------------ screener query

export interface UniverseQuery {
  minMarketCap?: number;
  maxMarketCap?: number;
  sectors?: string[];
  maxPe?: number;
  maxForwardPe?: number;
  maxPb?: number;
  maxEvEbitda?: number;
  minRevenueGrowth?: number; // fraction, e.g. 0.1
  minEpsGrowth?: number;
  minNetMargin?: number;
  minFcfYield?: number;
  minRoe?: number;
  minUpsidePct?: number;
  minRevisionScore?: number;
  minExpectationGap?: number;
  minTechnicalScore?: number;
  signals?: string[];
  setups?: string[];
  weeklyRegimes?: string[];
  minRiskReward?: number;
  maxDistanceToSupportPct?: number;
  valuationConfidence?: string[];
  text?: string;
  sortBy?: keyof OpportunitySnapshot;
  sortDir?: "asc" | "desc";
  limit?: number;
}

export function queryUniverse(q: UniverseQuery): { rows: OpportunitySnapshot[]; total: number } {
  let rows = getUniverseRows();
  const ge = (v: number | null, min: number | undefined) => min === undefined || (v !== null && v >= min);
  const le = (v: number | null, max: number | undefined) => max === undefined || (v !== null && v <= max);
  rows = rows.filter(
    (o) =>
      ge(o.marketCap, q.minMarketCap) &&
      le(o.marketCap, q.maxMarketCap) &&
      (!q.sectors?.length || (o.sector !== null && q.sectors.some((s) => s.toLowerCase() === o.sector!.toLowerCase()))) &&
      le(o.peTtm, q.maxPe) &&
      le(o.forwardPe, q.maxForwardPe) &&
      le(o.priceToBook, q.maxPb) &&
      le(o.evToEbitda, q.maxEvEbitda) &&
      ge(o.revenueGrowthYoY, q.minRevenueGrowth) &&
      ge(o.epsGrowthYoY, q.minEpsGrowth) &&
      ge(o.netMarginTtm, q.minNetMargin) &&
      ge(o.fcfYield, q.minFcfYield) &&
      ge(o.roe, q.minRoe) &&
      ge(o.upsidePct, q.minUpsidePct) &&
      ge(o.revisionScore, q.minRevisionScore) &&
      ge(o.expectationGapPct, q.minExpectationGap) &&
      ge(o.technicalScore, q.minTechnicalScore) &&
      (!q.signals?.length || (o.technicalSignal !== null && q.signals.includes(o.technicalSignal))) &&
      (!q.setups?.length || (o.setupType !== null && q.setups.includes(o.setupType))) &&
      (!q.weeklyRegimes?.length || (o.weeklyRegime !== null && q.weeklyRegimes.includes(o.weeklyRegime))) &&
      ge(o.riskReward, q.minRiskReward) &&
      le(o.distanceToSupportPct, q.maxDistanceToSupportPct) &&
      (!q.valuationConfidence?.length || (o.valuationConfidence !== null && q.valuationConfidence.includes(o.valuationConfidence))) &&
      (!q.text ||
        o.symbol.toLowerCase().includes(q.text.toLowerCase()) ||
        (o.name ?? "").toLowerCase().includes(q.text.toLowerCase())),
  );
  const total = rows.length;
  const key = q.sortBy ?? "egSetupScore";
  const dir = q.sortDir === "asc" ? 1 : -1;
  rows = [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    const an = typeof av === "number" ? av : av === null ? -Infinity : 0;
    const bn = typeof bv === "number" ? bv : bv === null ? -Infinity : 0;
    return (an - bn) * dir;
  });
  return { rows: rows.slice(0, q.limit ?? 100), total };
}
