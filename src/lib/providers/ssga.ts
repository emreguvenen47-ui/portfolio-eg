import "server-only";
import * as XLSX from "xlsx";
import type { ETFHoldingsSource, ETFProfile, Holding } from "./etf-holdings";

/**
 * ETF holdings from State Street's official daily files.
 *
 * SSGA publishes a real XLSX per fund at a stable URL — issuer data, not a
 * scrape of a rendered page — carrying ticker, weight, shares, sector and an
 * as-of date. That is the standard this app needs to activate look-through.
 *
 * Coverage is deliberately an explicit list rather than "try any symbol": a
 * wrong guess returns SSGA's 404 page as a 200 with HTML in it, and parsing
 * that would silently produce an empty fund rather than an error. Only funds
 * verified to serve a real workbook are listed.
 *
 * iShares and Invesco are not used: both answer a plain request with HTML or a
 * 503, so reaching their holdings would mean scraping a rendered page.
 */

const BASE = "https://www.ssga.com/us/en/library-content/products/fund-data/etfs/us";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) PortfolioEG/1.0";
const TIMEOUT_MS = 15_000;

/** Funds verified to return a parseable holdings workbook. */
const COVERED: Record<string, string> = {
  SPY: "spy",
  XLK: "xlk",
  XLE: "xle",
  XLF: "xlf",
  XLI: "xli",
  XLV: "xlv",
  XLY: "xly",
  XLP: "xlp",
  XLU: "xlu",
  XLB: "xlb",
  XLRE: "xlre",
  XLC: "xlc",
};

export const ssgaCovers = (symbol: string): boolean =>
  Boolean(COVERED[symbol.trim().toUpperCase()]);

/** SSGA writes "As of 10-Aug-2026"; normalise to ISO. */
function parseAsOf(raw: unknown): string | null {
  const s = String(raw ?? "");
  const m = s.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const mm = months[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
}

const numOrNull = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,%]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export const ssgaHoldingsSource: ETFHoldingsSource = {
  name: "State Street (SSGA) official daily holdings",

  async holdings(symbol: string) {
    const slug = COVERED[symbol.trim().toUpperCase()];
    if (!slug) return null;

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE}/holdings-daily-us-en-${slug}.xlsx`, {
        signal: ctl.signal,
        cache: "no-store",
        headers: { "User-Agent": UA },
      });
      if (!res.ok) return null;

      const type = res.headers.get("content-type") ?? "";
      // A missing fund returns SSGA's HTML error page with a 200. Parsing that
      // as a workbook would yield an empty fund rather than a failure.
      if (!type.includes("spreadsheet") && !type.includes("officedocument")) return null;

      const buf = Buffer.from(await res.arrayBuffer());
      const wb = XLSX.read(buf, { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) return null;

      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });

      // The header block is a few label/value pairs, then a column header row.
      let asOf: string | null = null;
      let fundName: string | null = null;
      let headerAt = -1;
      for (let i = 0; i < Math.min(rows.length, 15); i++) {
        const r = rows[i] as unknown[];
        const first = String(r?.[0] ?? "");
        if (/^fund name/i.test(first)) fundName = String(r[1] ?? "") || null;
        if (/^holdings/i.test(first)) asOf = parseAsOf(r[1]);
        if (/^name$/i.test(first) && r.some((c) => /^ticker/i.test(String(c ?? "")))) {
          headerAt = i;
          break;
        }
      }
      if (headerAt < 0) return null;

      const header = (rows[headerAt] as unknown[]).map((c) => String(c ?? "").toLowerCase());
      const col = (needle: string) => header.findIndex((h) => h.includes(needle));
      const iName = col("name");
      const iTicker = col("ticker");
      const iWeight = col("weight");
      const iSector = col("sector");
      const iShares = col("shares");
      const iCurrency = col("currency");
      if (iTicker < 0 || iWeight < 0) return null;

      const holdings: Holding[] = [];
      for (const raw of rows.slice(headerAt + 1)) {
        const r = raw as unknown[];
        const ticker = String(r[iTicker] ?? "").trim();
        const weight = numOrNull(r[iWeight]);
        if (!ticker || weight === null) continue;
        // SSGA lists cash and futures lines with placeholder tickers; keep them
        // out of look-through so they cannot masquerade as equity exposure.
        if (ticker === "-" || ticker === "--") continue;

        const sector = iSector >= 0 ? String(r[iSector] ?? "").trim() : "";
        holdings.push({
          ticker: ticker.toUpperCase(),
          name: iName >= 0 ? String(r[iName] ?? "").trim() : ticker,
          weight,
          // SSGA writes "-" when it does not classify a line.
          sector: sector && sector !== "-" ? sector : null,
          // The US equity files carry currency but not domicile; country is
          // genuinely absent rather than assumed to be US.
          country: null,
          value: null,
          weightChange: null,
        });
      }
      if (holdings.length === 0) return null;

      const profile: ETFProfile = {
        symbol: symbol.toUpperCase(),
        name: fundName,
        aum: null,
        expenseRatio: null,
        dividendYield: null,
        holdingsCount: holdings.length,
        asOf,
      };
      void iShares;
      void iCurrency;
      return { profile, holdings };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  },
};
