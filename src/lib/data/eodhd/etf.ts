import "server-only";
import { eodhdGet, eodhdNum } from "./client";
import { diskCache } from "@/lib/server/disk-cache";
import { toEodhdCode } from "@/lib/providers/eodhd";
import type { ETFHoldingsSource, ETFProfile, Holding } from "@/lib/providers/etf-holdings";

/**
 * EODHD ETF data — fundamentals for funds carry ETF_Data: top holdings with
 * weights, sector weights, asset allocation, AUM, expense ratio. This module
 * feeds the app-wide ETFHoldingsSource seam (lighting up every ETF surface)
 * and the richer per-fund view on the ticker page. Cached 24h on disk: fund
 * files move on publication cadence, not ticks.
 */

export interface EtfView {
  profile: ETFProfile;
  holdings: Holding[];
  sectorWeights: Array<{ sector: string; pct: number }>;
  assetAllocation: Array<{ bucket: string; pct: number }>;
  indexName: string | null;
  turnoverPct: number | null;
}

interface RawEtf {
  General?: Record<string, unknown>;
  ETF_Data?: {
    Company_Name?: string;
    Index_Name?: string;
    Yield?: string | number;
    NetExpenseRatio?: string | number;
    AnnualHoldingsTurnover?: string | number;
    TotalAssets?: string | number;
    Holdings?: Record<string, Record<string, unknown>>;
    Sector_Weights?: Record<string, { "Equity_%"?: string | number }>;
    Asset_Allocation?: Record<string, { "Net_Assets_%"?: string | number }>;
  };
}

const store = diskCache<EtfView | null>("eodhd-etf", 24 * 60 * 60_000);

export async function getEtfView(symbol: string): Promise<EtfView | null> {
  const code = toEodhdCode(symbol);
  if (!code || !code.endsWith(".US")) return null;
  const key = symbol.toUpperCase();
  const hit = store.get(key);
  if (hit !== undefined && hit !== null && !store.isStale(key)) return hit;

  try {
    const raw = await eodhdGet<RawEtf>(`/fundamentals/${encodeURIComponent(code)}`);
    if ((raw.General?.["Type"] as string) !== "ETF" || !raw.ETF_Data) {
      store.set(key, null);
      return null;
    }
    const e = raw.ETF_Data;
    const holdings: Holding[] = Object.values(e.Holdings ?? {})
      .map((h) => ({
        ticker: String(h["Code"] ?? ""),
        name: String(h["Name"] ?? ""),
        weight: eodhdNum(h["Assets_%"]) ?? 0,
        sector: (h["Sector"] as string) ?? null,
        country: (h["Country"] as string) ?? null,
        value: null,
        weightChange: null,
      }))
      .filter((h) => h.ticker && h.weight > 0)
      .sort((a, b) => b.weight - a.weight);

    const view: EtfView = {
      profile: {
        symbol: key,
        name: (raw.General?.["Name"] as string) ?? null,
        aum: eodhdNum(e.TotalAssets),
        expenseRatio: eodhdNum(e.NetExpenseRatio),
        dividendYield: eodhdNum(e.Yield),
        holdingsCount: holdings.length || null,
        asOf: null, // EODHD does not publish the file date on this payload
      },
      holdings,
      sectorWeights: Object.entries(e.Sector_Weights ?? {})
        .map(([sector, w]) => ({ sector, pct: eodhdNum(w["Equity_%"]) ?? 0 }))
        .filter((x) => x.pct > 0)
        .sort((a, b) => b.pct - a.pct),
      assetAllocation: Object.entries(e.Asset_Allocation ?? {})
        .map(([bucket, w]) => ({ bucket, pct: eodhdNum(w["Net_Assets_%"]) ?? 0 }))
        .filter((x) => Math.abs(x.pct) > 0.01)
        .sort((a, b) => b.pct - a.pct),
      indexName: e.Index_Name ?? null,
      turnoverPct: eodhdNum(e.AnnualHoldingsTurnover),
    };
    store.set(key, view);
    return view;
  } catch {
    return store.get(key) ?? null;
  }
}

/** The app-wide holdings source: registering this lights up overlap/look-through. */
export const eodhdEtfSource: ETFHoldingsSource = {
  name: "eodhd-etf-data",
  async holdings(symbol: string) {
    const v = await getEtfView(symbol);
    return v ? { profile: v.profile, holdings: v.holdings } : null;
  },
};
