import type { PositionValuation } from "@/lib/types";

/**
 * Portfolio X-Ray Lite.
 *
 * Aggregates the metadata the workbook and config already carry — asset class,
 * region, currency, theme — and nothing else. It does NOT look through an ETF
 * to its holdings: that data is not on the configured plan, and inferring
 * "roughly 8% NVDA" from a QQQ weight would be a fabricated number sitting
 * next to real ones.
 *
 * The shape below is deliberately look-through ready. `direct` and `indirect`
 * are separate fields, and `LookThroughSource` is the seam where a holdings
 * provider would plug in later; today `indirect` is always zero and the UI
 * says why.
 */

export interface XrayBucket {
  label: string;
  direct: number;
  indirect: number;
  total: number;
}

export interface XrayReport {
  byAssetClass: XrayBucket[];
  byRegion: XrayBucket[];
  byCurrency: XrayBucket[];
  byCategory: XrayBucket[];
  /** Themes overlap: a sleeve can carry several, so this column can exceed 100%. */
  byTheme: XrayBucket[];
  /** Named effective exposures the brief calls out explicitly. */
  effective: { label: string; weight: number; basis: string }[];
  /** True when any look-through source contributed. Always false for now. */
  hasLookThrough: boolean;
  note: string;
}

/**
 * The seam a real holdings provider would implement.
 *
 * Returning underlying weights per holding here is all it would take for the
 * aggregation below to start producing indirect exposure — no other change.
 * `src/lib/providers/etf-holdings.ts` is the concrete implementation point.
 */
export interface LookThroughSource {
  /** code -> { underlying ticker -> weight within that holding }. */
  holdings(codes: string[]): Promise<Record<string, Record<string, number>>>;
}

/** Effective exposure to one underlying company, direct plus via funds. */
export interface EffectiveHolding {
  ticker: string;
  direct: number;
  indirect: number;
  total: number;
  /** Which funds contribute, and how much each adds. */
  via: { fund: string; weight: number }[];
}

/**
 * Full look-through, when a holdings source is available.
 *
 * `fundHoldings` maps a fund code to its underlying weights as fractions of
 * that fund. A position missing from the map contributes only its direct
 * weight — it is NOT assumed to hold anything, because an unknown fund is not
 * an empty fund.
 */
export function lookThrough(
  rows: PositionValuation[],
  fundHoldings: Record<string, Record<string, number>>,
): { holdings: EffectiveHolding[]; covered: number; uncovered: string[] } {
  const direct = new Map<string, number>();
  const indirect = new Map<string, number>();
  const via = new Map<string, { fund: string; weight: number }[]>();
  const uncovered: string[] = [];
  let coveredWeight = 0;

  for (const r of rows) {
    const code = r.position.symbol ?? r.position.code;
    const underlying = fundHoldings[code];

    if (!underlying) {
      // Either a single stock (its own exposure) or a fund with no holdings
      // file. Both count as direct; only the fund case is a coverage gap.
      direct.set(code, (direct.get(code) ?? 0) + r.currentWeight);
      if (r.position.kind === "etf") uncovered.push(code);
      continue;
    }

    coveredWeight += r.currentWeight;
    for (const [ticker, w] of Object.entries(underlying)) {
      const contribution = r.currentWeight * w;
      indirect.set(ticker, (indirect.get(ticker) ?? 0) + contribution);
      via.set(ticker, [...(via.get(ticker) ?? []), { fund: code, weight: contribution }]);
    }
  }

  const tickers = new Set([...direct.keys(), ...indirect.keys()]);
  const holdings: EffectiveHolding[] = [...tickers]
    .map((ticker) => {
      const d = direct.get(ticker) ?? 0;
      const i = indirect.get(ticker) ?? 0;
      return {
        ticker,
        direct: d,
        indirect: i,
        total: d + i,
        via: (via.get(ticker) ?? []).sort((a, b) => b.weight - a.weight),
      };
    })
    .sort((a, b) => b.total - a.total);

  return { holdings, covered: coveredWeight, uncovered };
}

function aggregate(
  rows: PositionValuation[],
  key: (r: PositionValuation) => string,
): XrayBucket[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + r.currentWeight);
  return [...m.entries()]
    .map(([label, direct]) => ({ label, direct, indirect: 0, total: direct }))
    .sort((a, b) => b.total - a.total);
}

/** Themes are many-per-position, so they need their own fan-out pass. */
function aggregateMulti(
  rows: PositionValuation[],
  keys: (r: PositionValuation) => string[],
): XrayBucket[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const ks = keys(r);
    for (const k of ks.length ? ks : ["Untagged"]) {
      m.set(k, (m.get(k) ?? 0) + r.currentWeight);
    }
  }
  return [...m.entries()]
    .map(([label, direct]) => ({ label, direct, indirect: 0, total: direct }))
    .sort((a, b) => b.total - a.total);
}

export function buildXray(rows: PositionValuation[]): XrayReport {
  const byAssetClass = aggregate(rows, (r) => r.position.assetClass);
  const byRegion = aggregate(rows, (r) => r.position.region);
  const byCurrency = aggregate(rows, (r) => r.position.currencyCode);
  const byCategory = aggregate(rows, (r) => r.position.category || "Uncategorised");
  // A sleeve can carry several themes, so each is credited the full sleeve
  // weight rather than the position being forced into one label. That means
  // this column sums past 100% — intended, and the UI says so.
  const byTheme = aggregateMulti(rows, (r) => r.position.themes);

  const weightWhere = (pred: (r: PositionValuation) => boolean) =>
    rows.filter(pred).reduce((s, r) => s + r.currentWeight, 0);

  const themeWeight = (needle: string) =>
    rows
      .filter((r) => r.position.themes.some((t) => t.toLowerCase().includes(needle)))
      .reduce((s, r) => s + r.currentWeight, 0);

  const effective = [
    {
      label: "Technology / AI",
      weight: themeWeight("ai") + themeWeight("tech"),
      basis: "positions tagged with an AI or technology theme",
    },
    {
      label: "Semiconductors",
      weight: themeWeight("semi"),
      basis: "positions tagged with a semiconductor theme",
    },
    {
      label: "US",
      weight: weightWhere((r) => r.position.region === "US"),
      basis: "positions whose region is US",
    },
    {
      label: "China",
      weight: weightWhere((r) => r.position.region === "China"),
      basis: "positions whose region is China",
    },
    {
      label: "Emerging markets",
      weight: weightWhere((r) => r.position.region === "EM" || r.position.region === "China"),
      basis: "positions whose region is EM or China",
    },
    {
      label: "Turkey",
      weight: weightWhere((r) => r.position.region === "Turkey"),
      basis: "positions whose region is Turkey",
    },
    {
      label: "Real assets",
      weight: weightWhere((r) => r.position.assetClass === "Commodity"),
      basis: "positions whose asset class is Commodity",
    },
  ].filter((e) => e.weight > 0);

  return {
    byAssetClass,
    byRegion,
    byCurrency,
    byCategory,
    byTheme,
    effective,
    hasLookThrough: false,
    note:
      "Sleeve-level exposure only. ETF holdings are not available on the configured data plan, so exposure inside a fund — an NVDA weight reached through QQQ and SMH, say — is not counted and is not estimated.",
  };
}
