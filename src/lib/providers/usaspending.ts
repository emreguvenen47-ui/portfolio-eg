import "server-only";
import type { ContractSource, GovContract } from "@/lib/research/alt-data";

/**
 * Federal contract awards from USAspending.gov.
 *
 * The official public API, no key. Awards are matched by recipient name rather
 * than ticker — USAspending indexes legal entities, not listed securities —
 * so the name list below is explicit. Fuzzy-matching "Apple" would pull in
 * every unrelated company with the word in its name.
 *
 * The distinction the UI depends on is between the two dollar figures:
 * `obligatedAmount` is money the government has actually committed, while
 * `potentialAwardAmount` is the ceiling of an indefinite-delivery vehicle that
 * may never be spent. Treating a ceiling as revenue is the standard way this
 * data gets misread, so both are carried separately and labelled.
 */

const BASE = "https://api.usaspending.gov/api/v2";
const TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 24 * 60 * 60_000;

const CACHE_KEY = Symbol.for("pcc.usaspending.cache");
const cache: Map<string, { at: number; value: GovContract[] }> = ((
  globalThis as unknown as Record<symbol, Map<string, { at: number; value: GovContract[] }>>
)[CACHE_KEY] ??= new Map());

/**
 * Ticker to the recipient names that appear on federal awards.
 *
 * Explicit because the mapping is genuinely one-to-many and not derivable:
 * awards land on subsidiaries with names that do not contain the parent's.
 */
const RECIPIENTS: Record<string, string[]> = {
  MSFT: ["MICROSOFT CORPORATION"],
  AMZN: ["AMAZON WEB SERVICES, INC.", "AMAZON.COM SERVICES LLC"],
  GOOGL: ["GOOGLE LLC", "GOOGLE PUBLIC SECTOR LLC"],
  ORCL: ["ORACLE AMERICA, INC."],
  IBM: ["INTERNATIONAL BUSINESS MACHINES CORPORATION"],
  NVDA: ["NVIDIA CORPORATION"],
  PLTR: ["PALANTIR TECHNOLOGIES INC."],
  LMT: ["LOCKHEED MARTIN CORPORATION"],
  RTX: ["RAYTHEON COMPANY", "RTX CORPORATION"],
  NOC: ["NORTHROP GRUMMAN SYSTEMS CORPORATION"],
  GD: ["GENERAL DYNAMICS CORPORATION"],
  BA: ["THE BOEING COMPANY"],
  LHX: ["L3HARRIS TECHNOLOGIES, INC."],
  LDOS: ["LEIDOS, INC."],
  CAT: ["CATERPILLAR INC."],
  GE: ["GENERAL ELECTRIC COMPANY"],
  HON: ["HONEYWELL INTERNATIONAL INC."],
  AAPL: ["APPLE INC."],
  DELL: ["DELL FEDERAL SYSTEMS L.P."],
  ACN: ["ACCENTURE FEDERAL SERVICES LLC"],
};

export const usaspendingCovers = (ticker: string): boolean =>
  Boolean(RECIPIENTS[ticker.trim().toUpperCase()]);

interface AwardRow {
  "Award ID"?: string;
  "Recipient Name"?: string;
  "Awarding Agency"?: string;
  "Start Date"?: string;
  Description?: string;
  "Award Amount"?: number;
  "Total Outlays"?: number;
  "Contract Award Type"?: string;
  generated_internal_id?: string;
}

export const usaspendingSource: ContractSource = {
  name: "USAspending.gov",

  async contracts(ticker: string): Promise<GovContract[]> {
    const key = ticker.trim().toUpperCase();
    const names = RECIPIENTS[key];
    if (!names) return [];

    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      // Two years back: enough for a trend, small enough to stay one request.
      const start = new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10);
      const end = new Date().toISOString().slice(0, 10);

      const res = await fetch(`${BASE}/search/spending_by_award/`, {
        method: "POST",
        signal: ctl.signal,
        cache: "no-store",
        headers: { "content-type": "application/json", "User-Agent": "PortfolioEG/1.0" },
        body: JSON.stringify({
          filters: {
            award_type_codes: ["A", "B", "C", "D"],
            recipient_search_text: names,
            time_period: [{ start_date: start, end_date: end }],
          },
          fields: [
            "Award ID",
            "Recipient Name",
            "Awarding Agency",
            "Start Date",
            "Description",
            "Award Amount",
            "Total Outlays",
            "Contract Award Type",
          ],
          sort: "Award Amount",
          order: "desc",
          limit: 25,
          page: 1,
        }),
      });
      if (!res.ok) return [];

      const json = (await res.json()) as { results?: AwardRow[] };
      const value: GovContract[] = (json.results ?? []).map((r) => ({
        company: r["Recipient Name"] ?? key,
        ticker: key,
        agency: r["Awarding Agency"] ?? "N/A",
        awardDate: r["Start Date"] ?? "",
        program: r.Description ?? "N/A",
        // "Award Amount" on this endpoint is the obligated figure. The ceiling
        // lives on the award detail endpoint; rather than guess, it stays null
        // so the UI can only ever show money actually committed.
        obligatedAmount: typeof r["Award Amount"] === "number" ? r["Award Amount"] : null,
        potentialAwardAmount: null,
        type: r["Contract Award Type"] ?? "N/A",
        source: "USAspending.gov",
      }));

      cache.set(key, { at: Date.now(), value });
      return value;
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  },
};
