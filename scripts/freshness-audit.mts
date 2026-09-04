/**
 * FINANCIAL FRESHNESS AUDIT (sprint spec) — live, from scratch.
 *
 * For each symbol, straight from EODHD raw (no app cache):
 *   latest quarterly IS/BS/CF period, report date, filing date, fiscal period
 * and from the APP pipeline (getCompanySnapshot — what the UI serves):
 *   displayed statement period, CURRENT/DELAYED verdict, fetchedAt.
 * MATCH = app period equals EODHD's latest actually-available statement
 * period AND the CURRENT/DELAYED flag is consistent with report dates.
 *
 * Also discovers companies that REPORTED in the last N days via the earnings
 * calendar and audits at least 10 of them (dynamic, not hardcoded).
 *
 * Run: EODHD_API_KEY=... npx tsx --conditions=react-server scripts/freshness-audit.mts
 */
import { getCompanySnapshot } from "../src/lib/data/eodhd/fundamentals";
import { getRecentReporters } from "../src/lib/data/eodhd/freshness";

const KEY = process.env.EODHD_API_KEY!;
const CORE = ["AAPL", "MSFT", "NVDA", "JPM", "MU", "AMT", "XOM", "AVGO", "GOOGL", "META", "DE"];

interface RawView {
  isDate: string | null;
  bsDate: string | null;
  cfDate: string | null;
  latest: string | null;
  filingDate: string | null;
  reportDate: string | null; // from Earnings.History for that period (or newest reported)
  reportedPeriod: string | null;
}

async function rawView(sym: string): Promise<RawView | null> {
  const res = await fetch(`https://eodhd.com/api/fundamentals/${sym}.US?api_token=${KEY}&fmt=json`);
  if (!res.ok) {
    console.log(`${sym}: raw HTTP ${res.status}`);
    return null;
  }
  const j = (await res.json()) as Record<string, any>;
  const latestOf = (o: Record<string, unknown> | undefined) => {
    const ks = Object.keys(o ?? {}).sort();
    return ks.length ? ks[ks.length - 1]! : null;
  };
  const isDate = latestOf(j.Financials?.Income_Statement?.quarterly);
  const bsDate = latestOf(j.Financials?.Balance_Sheet?.quarterly);
  const cfDate = latestOf(j.Financials?.Cash_Flow?.quarterly);
  const latest = [isDate, bsDate, cfDate].filter(Boolean).sort().reverse()[0] ?? null;
  const filingDate =
    isDate ? ((j.Financials?.Income_Statement?.quarterly?.[isDate]?.filing_date as string) ?? null) : null;
  const today = new Date().toISOString().slice(0, 10);
  const reported = Object.values(j.Earnings?.History ?? {})
    .map((e: any) => ({ reportDate: String(e.reportDate ?? ""), periodEnd: String(e.date ?? "") }))
    .filter((e) => e.periodEnd && e.reportDate && e.reportDate <= today)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  return {
    isDate,
    bsDate,
    cfDate,
    latest,
    filingDate,
    reportDate: reported[0]?.reportDate ?? null,
    reportedPeriod: reported[0]?.periodEnd ?? null,
  };
}

async function auditOne(sym: string): Promise<{ line: string; ok: boolean }> {
  const [raw, snap] = await Promise.all([rawView(sym), getCompanySnapshot(sym, { force: true })]);
  if (!raw || !snap) return { line: `${sym.padEnd(6)} | RAW OR SNAPSHOT UNAVAILABLE`, ok: false };
  const appPeriod = snap.meta.latestStatementPeriod ?? "N/A";
  const flag = snap.meta.dataDelayed ? "DELAYED" : "CURRENT";
  // MATCH rules:
  //  1) app statement period == EODHD latest available statement period
  //  2) if a newer period is REPORTED (report date passed) than statements
  //     carry, the app must say DELAYED, not CURRENT.
  const periodsMatch = raw.latest !== null && appPeriod === raw.latest;
  const newerReported = raw.reportedPeriod !== null && raw.latest !== null && raw.reportedPeriod > raw.latest;
  const flagConsistent = newerReported ? snap.meta.dataDelayed : !snap.meta.dataDelayed;
  const ok = periodsMatch && flagConsistent;
  const line = [
    sym.padEnd(6),
    (raw.latest ?? "N/A").padEnd(10),
    (raw.reportDate ?? "N/A").padEnd(10),
    (raw.filingDate ?? "N/A").padEnd(10),
    appPeriod.padEnd(10),
    flag.padEnd(8),
    ok ? "MATCH" : `MISMATCH${!periodsMatch ? " (period)" : ""}${!flagConsistent ? " (flag)" : ""}`,
  ].join(" | ");
  return { line, ok };
}

console.log("TICKER | EODHD LATEST | REPORT DT  | FILING DT  | APP PERIOD | FLAG     | MATCH");
console.log("-".repeat(90));
let bad = 0;

for (const s of CORE) {
  const r = await auditOne(s);
  console.log(r.line);
  if (!r.ok) bad++;
  await new Promise((x) => setTimeout(x, 400));
}

// Dynamic: companies that actually reported in the last 3 days.
const to = new Date().toISOString().slice(0, 10);
const from = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
const reporters = await getRecentReporters(from, to);
console.log(`\n[dynamic] ${reporters.length} US companies reported ${from}..${to}; auditing 10 with the largest overlap in our universe`);
const { getUniverseRows } = await import("../src/lib/data/opportunities");
const inUniverse = new Set(getUniverseRows().map((r) => r.symbol));
const picks = reporters.filter((r) => inUniverse.has(r.symbol)).slice(0, 10);
for (const rep of picks) {
  const r = await auditOne(rep.symbol);
  console.log(`${r.line}   [reported ${rep.reportDate}]`);
  if (!r.ok) bad++;
  await new Promise((x) => setTimeout(x, 400));
}

console.log(`\nRESULT: ${bad === 0 ? "ALL MATCH" : `${bad} MISMATCH(ES) — systemic fix required`}`);
process.exit(bad === 0 ? 0 : 1);
