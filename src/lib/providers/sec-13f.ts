import "server-only";
import { buildResolver, resolveHolding, seedCusips } from "./cusip-resolve";
import type {
  InstitutionalHolder,
  OwnershipBreakdown,
  OwnershipSource,
} from "./ownership";
import { classifyChange } from "./ownership";

/**
 * Institutional holdings from SEC 13F filings.
 *
 * Official EDGAR, no key. The route that works is the submissions index plus
 * the filing's own information table:
 *
 *   data.sec.gov/submissions/CIK{cik}.json   -> accession, period, filed date
 *   sec.gov/Archives/edgar/data/{cik}/{acc}/ -> directory
 *   .../{table}.xml                          -> holdings
 *
 * The bulk `full-index` archive returns 403 to this client, so it is not used.
 * SEC requires a declared identity and asks for no more than ten requests a
 * second; both are honoured, and everything is cached per filing period since
 * a 13F never changes once filed.
 *
 * SCOPE, STATED HONESTLY: this answers "which of the managers we track hold
 * this stock", not "who owns this stock". Reverse-indexing every 13F filed in
 * a quarter is thousands of documents; a curated manager list is what can
 * actually be maintained, and the UI says so rather than implying completeness.
 */

const UA = "Portfolio EG emreguvenen47@gmail.com";
const TIMEOUT_MS = 20_000;
/** A filed 13F is immutable, so this only expires to pick up new quarters. */
const CACHE_TTL_MS = 12 * 60 * 60_000;

const CACHE_KEY = Symbol.for("pcc.sec13f.cache");
const cache: Map<string, { at: number; value: ManagerFiling[] }> = ((
  globalThis as unknown as Record<symbol, Map<string, { at: number; value: ManagerFiling[] }>>
)[CACHE_KEY] ??= new Map());

/** Managers whose filings are ingested. Large, long-lived, widely followed. */
export const TRACKED_MANAGERS: { cik: string; name: string }[] = [
  { cik: "0001067983", name: "Berkshire Hathaway" },
  // BlackRock files under a new entity from late 2024; the old CIK
  // (0001364742, "BlackRock Finance") stopped at 2024-06-30 and was quietly
  // serving two-year-old holdings next to current ones.
  { cik: "0002012383", name: "BlackRock" },
  { cik: "0000102909", name: "Vanguard Group" },
  { cik: "0000093751", name: "State Street" },
  { cik: "0001350694", name: "Bridgewater Associates" },
  { cik: "0001037389", name: "Renaissance Technologies" },
  { cik: "0001423053", name: "Citadel Advisors" },
  { cik: "0001056188", name: "Two Sigma Investments" },
  { cik: "0001167483", name: "Tiger Global Management" },
  { cik: "0001061768", name: "Baupost Group" },
  { cik: "0001336528", name: "Lone Pine Capital" },
  { cik: "0001418814", name: "Coatue Management" },
];

export interface Holding {
  issuer: string;
  cusip: string;
  value: number;
  shares: number;
}

/**
 * How far behind the newest filing a holder's own filing is.
 *
 * Managers file under entities that change, and a filer that has stopped
 * filing keeps returning its last snapshot forever. Two-year-old holdings
 * shown beside this quarter's, with no marking, read as current.
 */
export function quartersBehind(period: string, newest: string): number {
  const q = (d: string) => {
    const [y, m] = d.split("-").map(Number);
    return y * 4 + Math.floor((m - 1) / 3);
  };
  return Math.max(0, q(newest) - q(period));
}

export interface ManagerFiling {
  cik: string;
  manager: string;
  accession: string;
  reportPeriod: string;
  filedAt: string;
  sourceUrl: string;
  holdings: Holding[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string, asText = false): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      cache: "no-store",
      headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" },
    });
    if (!res.ok) return null;
    return asText ? await res.text() : await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Pull one tag's text from an XML fragment. */
const tag = (xml: string, name: string): string | null => {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`));
  return m ? m[1].trim() : null;
};

function parseInfoTable(xml: string): Holding[] {
  const out: Holding[] = [];
  const blocks = xml.split(/<(?:\w+:)?infoTable>/).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/(?:\w+:)?infoTable>/)[0];
    const issuer = tag(block, "nameOfIssuer");
    const cusip = tag(block, "cusip");
    const value = Number(tag(block, "value"));
    const shares = Number(tag(block, "sshPrnamt"));
    // `sshPrnamtType` of PRN is a principal amount of debt, not a share count;
    // mixing it into a share total would be nonsense.
    const type = tag(block, "sshPrnamtType");
    if (!issuer || !cusip || !Number.isFinite(value) || !Number.isFinite(shares)) continue;
    if (type && type !== "SH") continue;
    out.push({ issuer, cusip, value, shares });
  }
  return out;
}

/** The two most recent 13F-HR filings for one manager, oldest last. */
async function fetchManager(cik: string, name: string): Promise<ManagerFiling[]> {
  const key = cik;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const subs = await get(`https://data.sec.gov/submissions/CIK${cik}.json`);
  if (!subs) return hit?.value ?? [];

  let recent: {
    form?: string[];
    accessionNumber?: string[];
    reportDate?: string[];
    filingDate?: string[];
  };
  try {
    recent = (JSON.parse(subs) as { filings?: { recent?: typeof recent } }).filings?.recent ?? {};
  } catch {
    return hit?.value ?? [];
  }

  const forms = recent.form ?? [];
  const idx: number[] = [];
  for (let i = 0; i < forms.length && idx.length < 2; i++) {
    if (forms[i] === "13F-HR") idx.push(i);
  }
  if (!idx.length) return [];

  const bare = cik.replace(/^0+/, "");
  const out: ManagerFiling[] = [];

  for (const i of idx) {
    const accession = recent.accessionNumber?.[i] ?? "";
    const acc = accession.replace(/-/g, "");
    const dir = `https://www.sec.gov/Archives/edgar/data/${bare}/${acc}`;
    // SEC asks for ten requests a second at most; this stays well under.
    await sleep(150);
    const listing = await get(`${dir}/`);
    if (!listing) continue;

    // The information table is the XML that is not the cover page.
    const files = [...listing.matchAll(/([A-Za-z0-9_.-]+\.xml)/g)].map((m) => m[1]);
    const table = files.find((f) => !/primary_doc|^R\d+\.xml$/i.test(f));
    if (!table) continue;

    await sleep(150);
    const xml = await get(`${dir}/${table}`);
    if (!xml) continue;

    const holdings = parseInfoTable(xml);
    if (!holdings.length) continue;

    out.push({
      cik,
      manager: name,
      accession,
      reportPeriod: recent.reportDate?.[i] ?? "",
      filedAt: recent.filingDate?.[i] ?? "",
      sourceUrl: `${dir}/${table}`,
      holdings,
    });
  }

  if (out.length) cache.set(key, { at: Date.now(), value: out });
  return out.length ? out : (hit?.value ?? []);
}

/**
 * CUSIP is what a 13F reports; the app works in tickers.
 *
 * The mapping is built from the issuer names present in the filings against a
 * small explicit table. A CUSIP with no confident ticker is kept and shown by
 * issuer name rather than being guessed at — attaching the wrong ticker to a
 * position is worse than showing the issuer.
 */
const CUSIP_TO_TICKER: Record<string, string> = {
  "037833100": "AAPL",
  "594918104": "MSFT",
  "67066G104": "NVDA",
  "023135106": "AMZN",
  "02079K305": "GOOGL",
  "02079K107": "GOOG",
  "30303M102": "META",
  "88160R101": "TSLA",
  "46625H100": "JPM",
  "060505104": "BAC",
  "92826C839": "V",
  "57636Q104": "MA",
  "478160104": "JNJ",
  "742718109": "PG",
  "931142103": "WMT",
  "437076102": "HD",
  "166764100": "CVX",
  "30231G102": "XOM",
  "92343V104": "VZ",
  "00206R102": "T",
  "191216100": "KO",
  "713448108": "PEP",
  "58933Y105": "MRK",
  "717081103": "PFE",
  "532457108": "LLY",
  "91324P102": "UNH",
  "254687106": "DIS",
  "64110L106": "NFLX",
  "11135F101": "AVGO",
  "007903107": "AMD",
  "458140100": "INTC",
  "747525103": "QCOM",
  "882508104": "TXN",
  "595112103": "MU",
  "037411105": "APH",
  "20030N101": "CMCSA",
  "084670702": "BRK.B",
  "22160K105": "COST",
  "580135101": "MCD",
  "654106103": "NKE",
};

/**
 * Kept as the authoritative overrides, seeded into the resolver.
 *
 * Hand-verified pairings win over a name match, so a company whose listing
 * name differs from its filing name in a way normalisation cannot bridge can
 * still be pinned here.
 */
seedCusips(CUSIP_TO_TICKER);

export const cusipToTicker = (cusip: string): string | null =>
  CUSIP_TO_TICKER[cusip.toUpperCase()] ?? null;

/**
 * Ticker for a holding, using the issuer name when the CUSIP is unknown.
 *
 * Prefer this over `cusipToTicker`: the hand-written map covers forty
 * companies, and a large manager files forty thousand rows.
 */
export const holdingTicker = (cusip: string, issuer: string): string | null =>
  resolveHolding(cusip, issuer);

/** Ingest every tracked manager. Sequential, to stay polite with EDGAR. */
export async function loadTrackedFilings(): Promise<ManagerFiling[]> {
  // The resolver needs the listing; building it here means every caller gets
  // name matching without having to remember to ask for it.
  await buildResolver();
  const out: ManagerFiling[] = [];
  for (const m of TRACKED_MANAGERS) {
    const filings = await fetchManager(m.cik, m.name).catch(() => []);
    out.push(...filings);
  }
  return out;
}

export const sec13fSource: OwnershipSource = {
  name: "SEC EDGAR 13F-HR filings",

  async ownership(symbol: string) {
    const target = symbol.trim().toUpperCase();
    const filings = await loadTrackedFilings();
    if (!filings.length) return null;

    // Newest filing per manager, with the one before it for the comparison.
    const byManager = new Map<string, ManagerFiling[]>();
    for (const f of filings) {
      byManager.set(f.cik, [...(byManager.get(f.cik) ?? []), f]);
    }

    const holders: InstitutionalHolder[] = [];
    for (const [, list] of byManager) {
      const sorted = [...list].sort((a, b) => b.reportPeriod.localeCompare(a.reportPeriod));
      const latest = sorted[0];
      const prior = sorted[1];
      if (!latest) continue;

      /**
       * A 13F splits one position across several rows.
       *
       * The information table is broken out by investment discretion and by
       * the managers sharing voting authority, so Berkshire's Apple stake
       * arrives as six lines. Reading the first — which `find` did — reported
       * 692,000 shares against a real position near 57 million, an
       * understatement of two orders of magnitude that looked like a plausible
       * small holding. Every row for the CUSIP is summed.
       */
      const total = (f: ManagerFiling) => {
        const rows = f.holdings.filter((h) => holdingTicker(h.cusip, h.issuer) === target);
        if (rows.length === 0) return null;
        return {
          shares: rows.reduce((s, h) => s + h.shares, 0),
          value: rows.reduce((s, h) => s + h.value, 0),
          rows: rows.length,
        };
      };

      const now = total(latest);
      const then = prior ? total(prior) : null;
      // Absent from the latest filing and absent from the prior one means the
      // manager simply does not hold it — not a sale.
      if (!now && !then) continue;

      const shares = now?.shares ?? 0;
      const priorShares = then ? then.shares : null;

      holders.push({
        name: latest.manager,
        shares,
        ownershipPct: null,
        value: now?.value ?? null,
        asOf: latest.reportPeriod,
        filedAt: latest.filedAt,
        sharesPrior: priorShares,
        change: classifyChange(shares, priorShares),
        changeShares: priorShares === null ? null : shares - priorShares,
      });
    }

    if (!holders.length) return null;

    const breakdown: OwnershipBreakdown = {
      // Shares outstanding are not in a 13F, so a percentage of the company
      // cannot be derived from it. Left null rather than approximated.
      institutional: null,
      etf: null,
      insider: null,
    };

    return { holders: holders.sort((a, b) => (b.value ?? 0) - (a.value ?? 0)), breakdown };
  },
};

export const TRACKED_NOTE = `Covers ${TRACKED_MANAGERS.length} tracked managers' 13F-HR filings from SEC EDGAR, not the whole institutional base — reverse-indexing every 13F filed in a quarter is thousands of documents. A manager absent from this list is not absent from the register.`;
