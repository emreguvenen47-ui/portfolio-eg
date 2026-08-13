/**
 * Borsa İstanbul equities.
 *
 * A universe seam rather than per-page special cases: everything that needs to
 * know "is this a BIST name, and how do I price it" asks here. Prices and
 * history come through the existing Yahoo provider (`.IS` suffix), which is
 * the only configured source that carries Istanbul listings — Finnhub and
 * Twelve Data both refuse BIST symbols on this plan.
 *
 * Users see and type the plain BIST ticker (THYAO); the `.IS` form exists only
 * inside the Yahoo adapter.
 *
 * Data is delayed, not realtime. Every surface that shows a BIST price labels
 * it as such rather than implying a live tick.
 */

export type BistSector =
  | "Airline"
  | "Defence"
  | "Energy"
  | "Bank"
  | "Holding"
  | "Retail"
  | "Steel"
  | "Glass"
  | "Automotive"
  | "Telecom"
  | "Cement"
  | "Chemicals"
  | "Food"
  | "Other";

export interface BistListing {
  /** Plain BIST ticker, as displayed. */
  symbol: string;
  name: string;
  sector: BistSector;
  /**
   * Banks are analysed on a different metric set entirely — gross margin and
   * free cash flow are not meaningful for a balance-sheet business.
   */
  isBank: boolean;
}

/**
 * BIST 30-ish core universe.
 *
 * Deliberately a curated list rather than a scraped index membership file:
 * membership changes quarterly and a stale scrape would silently drop names.
 * Anything not listed here still resolves if the user types it — see
 * `looksLikeBistSymbol` — this list drives search suggestions and the scanner.
 */
export const BIST_UNIVERSE: BistListing[] = [
  { symbol: "THYAO", name: "Türk Hava Yolları", sector: "Airline", isBank: false },
  { symbol: "ASELS", name: "Aselsan", sector: "Defence", isBank: false },
  { symbol: "TUPRS", name: "Tüpraş", sector: "Energy", isBank: false },
  { symbol: "GARAN", name: "Garanti BBVA", sector: "Bank", isBank: true },
  { symbol: "AKBNK", name: "Akbank", sector: "Bank", isBank: true },
  { symbol: "YKBNK", name: "Yapı Kredi", sector: "Bank", isBank: true },
  { symbol: "ISCTR", name: "İş Bankası C", sector: "Bank", isBank: true },
  { symbol: "VAKBN", name: "VakıfBank", sector: "Bank", isBank: true },
  { symbol: "HALKB", name: "Halkbank", sector: "Bank", isBank: true },
  { symbol: "KCHOL", name: "Koç Holding", sector: "Holding", isBank: false },
  { symbol: "SAHOL", name: "Sabancı Holding", sector: "Holding", isBank: false },
  { symbol: "BIMAS", name: "BİM Mağazalar", sector: "Retail", isBank: false },
  { symbol: "MGROS", name: "Migros", sector: "Retail", isBank: false },
  { symbol: "EREGL", name: "Ereğli Demir Çelik", sector: "Steel", isBank: false },
  { symbol: "SISE", name: "Şişecam", sector: "Glass", isBank: false },
  { symbol: "FROTO", name: "Ford Otosan", sector: "Automotive", isBank: false },
  { symbol: "TOASO", name: "Tofaş", sector: "Automotive", isBank: false },
  { symbol: "TCELL", name: "Turkcell", sector: "Telecom", isBank: false },
  { symbol: "TTKOM", name: "Türk Telekom", sector: "Telecom", isBank: false },
  { symbol: "PETKM", name: "Petkim", sector: "Chemicals", isBank: false },
  { symbol: "KOZAL", name: "Koza Altın", sector: "Other", isBank: false },
  { symbol: "PGSUS", name: "Pegasus", sector: "Airline", isBank: false },
  { symbol: "OYAKC", name: "Oyak Çimento", sector: "Cement", isBank: false },
  { symbol: "ULKER", name: "Ülker Bisküvi", sector: "Food", isBank: false },
  { symbol: "ENKAI", name: "Enka İnşaat", sector: "Other", isBank: false },
  { symbol: "ASTOR", name: "Astor Enerji", sector: "Energy", isBank: false },
  { symbol: "TAVHL", name: "TAV Havalimanları", sector: "Airline", isBank: false },
];

const BY_SYMBOL = new Map(BIST_UNIVERSE.map((b) => [b.symbol, b]));

/** The BIST 100 index, already carried by the existing market config. */
export const BIST_INDEX = "XU100";

export const bistListing = (symbol: string): BistListing | undefined =>
  BY_SYMBOL.get(symbol.trim().toUpperCase().replace(/\.IS$/, ""));

/**
 * Is this a BIST symbol?
 *
 * Known universe members count, and so does an explicit `.IS` suffix. A bare
 * five-letter ticker is NOT assumed to be Turkish — plenty of US tickers are
 * five letters, and guessing would route them to the wrong provider.
 */
/**
 * Extra tickers proven to exist on BIST by the reference universe.
 *
 * Populated by `bist-universe` after its first load, so recognition is not
 * limited to the curated list — that limitation was why most of the exchange
 * could not be looked up at all.
 */
const DISCOVERED = new Set<string>();

export function registerBistTickers(tickers: string[]): void {
  for (const t of tickers) DISCOVERED.add(t.trim().toUpperCase());
}

export function isBistSymbol(symbol: string): boolean {
  const s = symbol.trim().toUpperCase().replace(/\.IS$/, "");
  return (
    symbol.trim().toUpperCase().endsWith(".IS") ||
    BY_SYMBOL.has(s) ||
    DISCOVERED.has(s) ||
    s === BIST_INDEX
  );
}

/** Display form: what the user types and reads. */
export const toBistDisplay = (symbol: string): string =>
  symbol.trim().toUpperCase().replace(/\.IS$/, "");

/** Yahoo form: the only place the `.IS` suffix should appear. */
export function toBistYahoo(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  return s.endsWith(".IS") ? s : `${s}.IS`;
}

export const isTurkishBank = (symbol: string): boolean =>
  bistListing(symbol)?.isBank ?? false;

/** Search suggestions from the curated universe, by ticker or company name. */
export function searchBist(query: string, limit = 8): BistListing[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const norm = (s: string) =>
    s.toUpperCase().replace(/İ/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C");
  const nq = norm(q);
  return BIST_UNIVERSE.filter(
    (b) => b.symbol.startsWith(nq) || norm(b.name).includes(nq),
  ).slice(0, limit);
}
