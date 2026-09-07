import "server-only";
import { diskCache } from "@/lib/server/disk-cache";
import { reportAttempt, inBackoff } from "./congress-health";
import { normalizePolitician } from "./congress-archive";
import type { CongressSource, CongressTrade } from "./alt-data";

/**
 * FMP CONGRESSIONAL DISCLOSURES — the PRIMARY congress source.
 *
 * Financial Modeling Prep's `stable/senate-latest` and `stable/house-latest`
 * republish the official Senate EFD / House Clerk filings as JSON, under an
 * API key this deployment already holds — a legitimate, ToS-clean server-side
 * feed (verified live 2026-09-07). The current plan caps each pull at the 25
 * most recent disclosures per chamber, so this module ACCUMULATES: every pull
 * merges into a rolling disk ledger keyed by filing identity. All rows are
 * genuine filings with their House/Senate source links; history simply grows
 * deeper the longer the app runs.
 *
 * Freshness: 30-minute TTL (disclosures land on a daily cadence). On upstream
 * failure the ledger serves as last-known-good and health reports STALE with
 * the exact last-success timestamp — never a fabricated row, never silence.
 */

const SOURCE = "fmp-congress";
const TTL_MS = 30 * 60_000;
const BACKOFF_MS = 60 * 60_000; // after 429/403: hands off for an hour

interface FmpRow {
  symbol?: string;
  disclosureDate?: string;
  transactionDate?: string;
  firstName?: string;
  lastName?: string;
  office?: string;
  district?: string;
  owner?: string;
  assetDescription?: string;
  type?: string;
  amount?: string;
  link?: string;
}

interface Ledger {
  rows: CongressTrade[];
  updatedAt: string; // last successful merge
}

const ledgerStore = diskCache<Ledger>("congress-fmp-ledger", Number.POSITIVE_INFINITY);
const LEDGER_KEY = "ledger";

const key = (): string | null => process.env.FMP_API_KEY?.trim() || null;

/** "$1,001 - $15,000" → [1001, 15000]; "$1,000,001 +" → [1000001, null]. */
function amountRange(a: string | undefined): [number | null, number | null] {
  if (!a) return [null, null];
  const nums = a.match(/\$([\d,]+)/g)?.map((x) => Number(x.replace(/[$,]/g, ""))) ?? [];
  return [nums[0] ?? null, nums[1] ?? nums[0] ?? null];
}

function sideOf(type: string | undefined): "BUY" | "SELL" | null {
  const t = (type ?? "").toLowerCase();
  if (t.includes("purchase") || t === "buy" || t.includes("receive")) return "BUY";
  if (t.includes("sale") || t.includes("sell") || t.includes("exchange")) return "SELL";
  return null;
}

function normalize(r: FmpRow, chamber: "House" | "Senate"): CongressTrade | null {
  const side = sideOf(r.type);
  const ticker = (r.symbol ?? "").trim().toUpperCase();
  if (!side || !ticker || !r.transactionDate) return null;
  const [lo, hi] = amountRange(r.amount);
  const district = r.district ?? "";
  return {
    politician: normalizePolitician([r.firstName, r.lastName].filter(Boolean).join(" ") || (r.office ?? "Unknown")),
    chamber,
    ticker,
    side,
    transactionDate: r.transactionDate,
    disclosureDate: r.disclosureDate ?? "",
    valueLow: lo,
    valueHigh: hi,
    // Party is not in this feed — published as null rather than guessed.
    party: null,
    state: district ? district.slice(0, 2) : null,
    company: r.assetDescription ?? null,
    owner: r.owner || null,
    source: SOURCE,
    sourceUrl: r.link ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

const identity = (t: CongressTrade) =>
  `${t.politician}|${t.ticker}|${t.transactionDate}|${t.side}|${t.valueLow ?? ""}|${t.owner ?? ""}`;

async function pull(chamber: "House" | "Senate"): Promise<{ rows: CongressTrade[]; status: number }> {
  const path = chamber === "Senate" ? "senate-latest" : "house-latest";
  const res = await fetch(
    `https://financialmodelingprep.com/stable/${path}?limit=25&apikey=${key()}`,
    { cache: "no-store", signal: AbortSignal.timeout(12_000) },
  );
  if (!res.ok) return { rows: [], status: res.status };
  const json = (await res.json()) as FmpRow[] | { ["Error Message"]?: string };
  if (!Array.isArray(json)) return { rows: [], status: 402 };
  return { rows: json.map((r) => normalize(r, chamber)).filter((x): x is CongressTrade => x !== null), status: 200 };
}

/** Refresh the rolling ledger if due; always return current ledger + health. */
export async function refreshLedger(force = false): Promise<Ledger> {
  const ledger = ledgerStore.get(LEDGER_KEY) ?? { rows: [], updatedAt: "" };
  const age = ledger.updatedAt ? Date.now() - Date.parse(ledger.updatedAt) : null;

  if (!key()) {
    reportAttempt(SOURCE, { ok: false, httpStatus: null, cachedRows: ledger.rows.length, cacheAgeMs: age, note: "FMP_API_KEY not configured" });
    return ledger;
  }
  if (!force && age !== null && age < TTL_MS) return ledger; // fresh enough
  if (!force && inBackoff(SOURCE, BACKOFF_MS)) return ledger;

  try {
    const [senate, house] = await Promise.all([pull("Senate"), pull("House")]);
    const status = senate.status === 200 || house.status === 200 ? 200 : Math.max(senate.status, house.status);
    const fresh = [...senate.rows, ...house.rows];
    if (!fresh.length) {
      reportAttempt(SOURCE, { ok: false, httpStatus: status, cachedRows: ledger.rows.length, cacheAgeMs: age, note: "upstream returned no parsable rows" });
      return ledger;
    }
    // Merge into the rolling ledger (dedupe on filing identity), newest first.
    const byId = new Map(ledger.rows.map((r) => [identity(r), r]));
    for (const r of fresh) byId.set(identity(r), r);
    const merged = [...byId.values()]
      .sort((a, b) => (b.disclosureDate || b.transactionDate).localeCompare(a.disclosureDate || a.transactionDate))
      .slice(0, 2000);
    const next: Ledger = { rows: merged, updatedAt: new Date().toISOString() };
    ledgerStore.set(LEDGER_KEY, next);
    ledgerStore.flushNow();
    reportAttempt(SOURCE, { ok: true, httpStatus: 200, rows: fresh.length, cachedRows: merged.length, cacheAgeMs: 0 });
    return next;
  } catch (e) {
    reportAttempt(SOURCE, {
      ok: false,
      httpStatus: null,
      cachedRows: ledger.rows.length,
      cacheAgeMs: age,
      note: (e as Error).message.slice(0, 120),
    });
    return ledger;
  }
}

export const fmpCongressSource: CongressSource = {
  name: SOURCE,
  async trades(ticker: string): Promise<CongressTrade[]> {
    const ledger = await refreshLedger();
    const rows = ticker ? ledger.rows.filter((r) => r.ticker === ticker.toUpperCase()) : ledger.rows;
    return rows;
  },
};
