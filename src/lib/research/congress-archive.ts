import "server-only";
import { diskCache } from "@/lib/server/disk-cache";
import { reportAttempt } from "./congress-health";
import type { CongressTrade } from "./alt-data";

/**
 * CONGRESSIONAL ARCHIVE — deep history from the public stock-watcher
 * aggregates on GitHub (the projects that originally republished the official
 * Senate EFD / House Clerk records):
 *
 *  - House:  TattooedHead/house-stock-watcher-data — ~24k transactions,
 *            2013→present, actively updated, each row carries its clerk
 *            source_url. (Continuation of the original dataset.)
 *  - Senate: timothycarambat/senate-stock-watcher-data — ~8.3k transactions,
 *            2014–2019 archive, each row carries its EFD ptr_link.
 *
 * Verified live 2026-09-07. Both are static JSON fetched at most weekly and
 * kept on disk; combined with the live FMP ledger this gives 12 years of
 * disclosed trades. Rows keep their original filing links — every line is
 * traceable to the official record.
 */

const WEEK_MS = 7 * 24 * 60 * 60_000;
const store = diskCache<{ rows: CongressTrade[]; fetchedAt: string }>("congress-archive", WEEK_MS);
const KEY = "archive";

const SENATE_URL =
  "https://raw.githubusercontent.com/timothycarambat/senate-stock-watcher-data/master/aggregate/all_transactions.json";
const HOUSE_URL =
  "https://raw.githubusercontent.com/TattooedHead/house-stock-watcher-data/main/data/all_transactions.json";

/** "01/23/2019" or "2019-01-23" → ISO, else "". */
function iso(d: string | undefined): string {
  if (!d) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d.trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : "";
}

function amountRange(a: string | undefined): [number | null, number | null] {
  if (!a) return [null, null];
  const nums = a.match(/\$([\d,]+)/g)?.map((x) => Number(x.replace(/[$,]/g, ""))) ?? [];
  return [nums[0] ?? null, nums[1] ?? nums[0] ?? null];
}

function sideOf(type: string | undefined): "BUY" | "SELL" | null {
  const t = (type ?? "").toLowerCase();
  if (t.includes("purchase")) return "BUY";
  if (t.includes("sale") || t.includes("exchange")) return "SELL";
  return null;
}

/** "Hon. John J. Mr McGuire" → "John McGuire": titles out, middle tokens out. */
export function normalizePolitician(name: string): string {
  const tokens = name
    .replace(/\b(Hon|Mr|Mrs|Ms|Dr|Jr|Sr|II|III|IV)\.?\b/gi, " ")
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length <= 2) return tokens.join(" ");
  return `${tokens[0]} ${tokens[tokens.length - 1]}`;
}

const cleanTicker = (t: string | undefined): string => {
  const s = (t ?? "").trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(s) && s !== "N/A" ? s.replace(/\./g, "-") : "";
};

interface SenateRow {
  transaction_date?: string;
  owner?: string;
  ticker?: string;
  asset_description?: string;
  type?: string;
  amount?: string;
  senator?: string;
  ptr_link?: string;
}

interface HouseRow extends SenateRow {
  disclosure_date?: string;
  representative?: string;
  district?: string;
  source_url?: string;
  filing_id?: string;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(45_000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getArchiveRows(): Promise<CongressTrade[]> {
  const hit = store.get(KEY);
  if (hit && !store.isStale(KEY)) return hit.rows;

  const fetchedAt = new Date().toISOString();
  const [senate, house] = await Promise.all([fetchJson<SenateRow[]>(SENATE_URL), fetchJson<HouseRow[]>(HOUSE_URL)]);

  if (!senate && !house) {
    reportAttempt("archive", { ok: false, httpStatus: null, cachedRows: hit?.rows.length ?? 0, cacheAgeMs: hit ? Date.now() - Date.parse(hit.fetchedAt) : null, note: "GitHub aggregates unreachable" });
    return hit?.rows ?? [];
  }

  const rows: CongressTrade[] = [];
  for (const r of senate ?? []) {
    const side = sideOf(r.type);
    const ticker = cleanTicker(r.ticker);
    const tx = iso(r.transaction_date);
    if (!side || !ticker || !tx) continue;
    const [lo, hi] = amountRange(r.amount);
    rows.push({
      politician: normalizePolitician(r.senator ?? "Unknown"),
      chamber: "Senate",
      ticker,
      side,
      transactionDate: tx,
      disclosureDate: "",
      valueLow: lo,
      valueHigh: hi,
      party: null,
      state: null,
      company: r.asset_description?.slice(0, 80) ?? null,
      owner: r.owner || null,
      source: "senate-stock-watcher (archive)",
      sourceUrl: r.ptr_link ?? null,
      fetchedAt,
    });
  }
  for (const r of house ?? []) {
    const side = sideOf(r.type);
    const ticker = cleanTicker(r.ticker);
    const tx = iso(r.transaction_date);
    if (!side || !ticker || !tx) continue;
    const [lo, hi] = amountRange(r.amount);
    rows.push({
      politician: normalizePolitician(r.representative ?? "Unknown"),
      chamber: "House",
      ticker,
      side,
      transactionDate: tx,
      disclosureDate: iso(r.disclosure_date),
      valueLow: lo,
      valueHigh: hi,
      party: null,
      state: r.district ? r.district.slice(0, 2) : null,
      company: r.asset_description?.slice(0, 80) ?? null,
      owner: r.owner || null,
      source: "house-stock-watcher (archive)",
      sourceUrl: r.source_url ?? null,
      fetchedAt,
    });
  }

  rows.sort((a, b) => (b.disclosureDate || b.transactionDate).localeCompare(a.disclosureDate || a.transactionDate));
  store.set(KEY, { rows, fetchedAt });
  store.flushNow();
  reportAttempt("archive", { ok: true, httpStatus: 200, rows: rows.length, cachedRows: rows.length, cacheAgeMs: 0 });
  return rows;
}

/** Archive + live FMP ledger, deduped on filing identity. Newest first. */
export async function getAllCongressRows(ticker?: string): Promise<CongressTrade[]> {
  const { fmpCongressSource } = await import("./fmp-congress");
  const [archive, live] = await Promise.all([
    getArchiveRows().catch(() => []),
    fmpCongressSource.trades("").catch(() => []),
  ]);
  const seen = new Set<string>();
  const out: CongressTrade[] = [];
  for (const r of [...live, ...archive]) {
    const k = `${r.politician.toLowerCase()}|${r.ticker}|${r.transactionDate}|${r.side}|${r.valueLow ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (!ticker || r.ticker === ticker.toUpperCase()) out.push(r);
  }
  out.sort((a, b) => (b.transactionDate).localeCompare(a.transactionDate));
  return out;
}
