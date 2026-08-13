/**
 * Event chains and world-event exposure.
 *
 * Deterministic, hand-authored mappings. Every link carries a `why` because a
 * chain without reasoning is just an assertion — and because the reasoning is
 * the part worth disagreeing with. Nothing here is generated, and nothing
 * calls a model; the EXPAND button on the UI is the only path to AI and it is
 * explicit.
 *
 * These are transmission mechanisms, not forecasts. "AI capex rises therefore
 * copper demand rises" describes how the linkage works if the first thing
 * happens — it does not say it will.
 */

export type Order = 1 | 2 | 3;
export type Confidence = "HIGH" | "MEDIUM" | "LOW";
export type ExposureKind = "DIRECT" | "INDIRECT" | "HEDGE";

export interface ChainNode {
  id: string;
  label: string;
  order: Order;
  /** Why this follows from the node before it. */
  why: string;
  confidence: Confidence;
  /** Tickers this node touches — US, ETF or BIST. */
  assets: string[];
}

export interface EventChain {
  id: string;
  title: string;
  premise: string;
  /** What would have to be true for the chain to start. */
  trigger: string;
  nodes: ChainNode[];
}

export const CHAINS: EventChain[] = [
  {
    id: "ai-capex",
    title: "AI capital expenditure rises",
    premise:
      "Hyperscalers raise data-centre budgets. The spend propagates down a physical supply chain that ends in power and metals, which is why the later links are slower and less crowded than the first.",
    trigger: "Cloud capex guidance revised up at the major hyperscalers",
    nodes: [
      {
        id: "gpu",
        label: "GPU and accelerator demand",
        order: 1,
        why: "Compute is the line item capex is spent on first; orders convert to revenue within a quarter or two.",
        confidence: "HIGH",
        assets: ["NVDA", "AMD", "AVGO", "SMH"],
      },
      {
        id: "foundry",
        label: "Foundry utilisation",
        order: 2,
        why: "Accelerators are fabricated at leading-edge nodes concentrated in a handful of plants, so unit growth shows up directly in foundry loading.",
        confidence: "HIGH",
        assets: ["TSM", "SMH"],
      },
      {
        id: "equipment",
        label: "Semiconductor equipment",
        order: 2,
        why: "Sustained utilisation forces capacity additions, and tool orders lead new capacity by roughly a year.",
        confidence: "MEDIUM",
        assets: ["ASML", "AMAT", "LRCX", "KLAC", "SMH"],
      },
      {
        id: "power",
        label: "Power generation and grid",
        order: 3,
        why: "A data centre is a large, constant electrical load. Siting is increasingly constrained by available interconnection rather than by capital.",
        confidence: "MEDIUM",
        assets: ["GEV", "VST", "CEG", "XLU"],
      },
      {
        id: "cooling",
        label: "Cooling and electrical equipment",
        order: 3,
        why: "Rack density from accelerators exceeds what air cooling handles, pulling forward liquid cooling and switchgear demand.",
        confidence: "MEDIUM",
        assets: ["ETN", "VRT", "JCI"],
      },
      {
        id: "copper",
        label: "Copper and industrial metals",
        order: 3,
        why: "Grid build-out and electrical distribution are copper-intensive, though data centres are a small share of total copper demand — this link is real but dilute.",
        confidence: "LOW",
        assets: ["CPER", "FCX", "XLB"],
      },
    ],
  },
  {
    id: "china-stimulus",
    title: "China stimulus expands",
    premise:
      "Fiscal or property support in China feeds through construction activity into commodity demand, and from there into exporters of capital equipment.",
    trigger: "Policy easing, property support or a large fiscal package announced",
    nodes: [
      {
        id: "activity",
        label: "Construction and industrial activity",
        order: 1,
        why: "Chinese stimulus has historically been delivered through infrastructure and property, both construction-intensive.",
        confidence: "MEDIUM",
        assets: ["KWEB", "FXI", "EMXC"],
      },
      {
        id: "metals",
        label: "Industrial metals demand",
        order: 2,
        why: "China is the largest single consumer of copper, iron ore and steel, so a domestic activity impulse moves the global price rather than just the local one.",
        confidence: "HIGH",
        assets: ["CPER", "FCX", "XLB"],
      },
      {
        id: "steel-tr",
        label: "Turkish steel and exporters",
        order: 3,
        why: "Turkish steel competes and prices off global benchmarks, so a China-driven move in steel and scrap reaches Erdemir's realised prices.",
        confidence: "MEDIUM",
        assets: ["EREGL", "XU100"],
      },
      {
        id: "equipment-exporters",
        label: "Capital equipment exporters",
        order: 3,
        why: "Sustained construction demand pulls machinery orders, which sit with a small number of global suppliers.",
        confidence: "MEDIUM",
        assets: ["CAT", "XLI"],
      },
    ],
  },
  {
    id: "taiwan-risk",
    title: "Taiwan Strait risk rises",
    premise:
      "Leading-edge logic manufacturing is geographically concentrated to a degree that has no modern parallel. A disruption is not a supply shock in one component; it is a supply shock in the input to most electronics.",
    trigger: "Military, blockade or export-control escalation around Taiwan",
    nodes: [
      {
        id: "tsm",
        label: "Leading-edge foundry supply",
        order: 1,
        why: "The overwhelming majority of sub-5nm capacity sits on one island, and no alternative can be qualified within quarters.",
        confidence: "HIGH",
        assets: ["TSM"],
      },
      {
        id: "fabless",
        label: "Fabless designers",
        order: 2,
        why: "Companies that design but do not manufacture depend on that capacity directly; a supply interruption caps units regardless of demand.",
        confidence: "HIGH",
        assets: ["NVDA", "AMD", "AAPL", "QCOM", "SMH"],
      },
      {
        id: "ai-ecosystem",
        label: "Downstream AI build-out",
        order: 3,
        why: "Data-centre expansion is gated by accelerator supply, so a foundry constraint delays the whole build cycle rather than reallocating it.",
        confidence: "MEDIUM",
        assets: ["MSFT", "GOOGL", "AMZN", "GEV"],
      },
      {
        id: "safe-haven",
        label: "Safe-haven demand",
        order: 3,
        why: "Geopolitical escalation of this kind has historically bid gold and the dollar while compressing risk assets — a partial offset for a diversified book.",
        confidence: "MEDIUM",
        assets: ["GLDM", "DXY"],
      },
    ],
  },
  {
    id: "tariffs",
    title: "Tariffs and trade restrictions widen",
    premise:
      "Tariffs raise input costs for importers and shift demand toward domestic substitutes, with the incidence depending on who has pricing power.",
    trigger: "New tariff schedules or export controls announced",
    nodes: [
      {
        id: "importers",
        label: "Import-dependent margins",
        order: 1,
        why: "A tariff is a cost at the border. Companies without the pricing power to pass it on absorb it in gross margin.",
        confidence: "HIGH",
        assets: ["XLY", "XRT"],
      },
      {
        id: "domestic",
        label: "Domestic substitutes",
        order: 2,
        why: "Protected domestic producers gain relative price advantage, which is the stated purpose of the policy.",
        confidence: "MEDIUM",
        assets: ["XLI", "NUE", "EREGL"],
      },
      {
        id: "inflation",
        label: "Goods inflation and policy path",
        order: 3,
        why: "Broad tariffs raise measured goods prices, complicating the disinflation path and therefore the rate path.",
        confidence: "MEDIUM",
        assets: ["US2Y", "US10Y", "GLDM"],
      },
    ],
  },
  {
    id: "tr-rates",
    title: "Turkish rate and lira regime shifts",
    premise:
      "Turkish policy changes reach domestic equities through two channels that pull in opposite directions: bank margins and the translated value of foreign-currency earnings.",
    trigger: "TCMB policy change or a step move in USD/TRY",
    nodes: [
      {
        id: "banks",
        label: "Bank net interest margins",
        order: 1,
        why: "Turkish banks fund short and lend at longer duration, so the direction and speed of policy moves margins directly.",
        confidence: "HIGH",
        assets: ["GARAN", "AKBNK", "YKBNK", "ISCTR"],
      },
      {
        id: "exporters",
        label: "FX-earning exporters",
        order: 2,
        why: "Companies earning hard currency against a largely lira cost base see translated earnings rise when the lira weakens.",
        confidence: "MEDIUM",
        assets: ["THYAO", "TUPRS", "EREGL", "FROTO"],
      },
      {
        id: "domestic-demand",
        label: "Domestic demand names",
        order: 3,
        why: "Real incomes and credit availability drive domestic consumption, which is where retail and autos sit.",
        confidence: "MEDIUM",
        assets: ["BIMAS", "MGROS", "TOASO"],
      },
      {
        id: "usd-hedge",
        label: "Hard-currency offset",
        order: 3,
        why: "A USD-denominated sleeve appreciates in lira terms during a lira decline, offsetting domestic losses for a TRY-based investor.",
        confidence: "HIGH",
        assets: ["SPY", "GLDM", "SGOV"],
      },
    ],
  },
];

export const chainById = (id: string) => CHAINS.find((c) => c.id === id);

/** Which chains touch a given ticker, and where. */
export function chainsForAsset(symbol: string): { chain: EventChain; nodes: ChainNode[] }[] {
  const s = symbol.trim().toUpperCase();
  return CHAINS.map((chain) => ({
    chain,
    nodes: chain.nodes.filter((n) => n.assets.includes(s)),
  })).filter((x) => x.nodes.length > 0);
}

// ------------------------------------------------------- world-event layer

export interface WorldEventTheme {
  id: string;
  label: string;
  category:
    | "Geopolitical"
    | "Trade"
    | "Regulatory"
    | "Election"
    | "Energy"
    | "Semiconductor"
    | "AI regulation"
    | "Supply chain";
  /** Assets and how they are exposed. */
  exposures: { symbol: string; kind: ExposureKind; why: string }[];
  /** Chain this theme feeds, when there is one. */
  chainId?: string;
}

export const WORLD_THEMES: WorldEventTheme[] = [
  {
    id: "taiwan",
    label: "Taiwan Strait escalation",
    category: "Geopolitical",
    chainId: "taiwan-risk",
    exposures: [
      { symbol: "SMH", kind: "DIRECT", why: "Semiconductor index whose largest constituents depend on Taiwanese fabrication." },
      { symbol: "NVDA", kind: "DIRECT", why: "Fabless; all leading-edge product is manufactured in Taiwan." },
      { symbol: "QQQ", kind: "INDIRECT", why: "Heavy weighting in companies whose hardware supply runs through Taiwan." },
      { symbol: "GLDM", kind: "HEDGE", why: "Gold has historically bid during geopolitical escalation." },
    ],
  },
  {
    id: "tariffs",
    label: "Tariff escalation",
    category: "Trade",
    chainId: "tariffs",
    exposures: [
      { symbol: "XLY", kind: "DIRECT", why: "Consumer discretionary carries the highest imported-goods content." },
      { symbol: "EREGL", kind: "INDIRECT", why: "Turkish steel gains or loses depending on where trade barriers land." },
      { symbol: "GLDM", kind: "HEDGE", why: "Tariff-driven inflation and policy uncertainty support gold." },
    ],
  },
  {
    id: "ai-regulation",
    label: "AI regulation tightens",
    category: "AI regulation",
    exposures: [
      { symbol: "NVDA", kind: "DIRECT", why: "Export controls on advanced accelerators restrict addressable market directly." },
      { symbol: "MSFT", kind: "INDIRECT", why: "Compliance cost and deployment restrictions slow enterprise AI rollout." },
      { symbol: "SGOV", kind: "HEDGE", why: "Cash is the offset when a concentrated theme derates." },
    ],
  },
  {
    id: "energy-shock",
    label: "Energy supply shock",
    category: "Energy",
    exposures: [
      { symbol: "XLE", kind: "DIRECT", why: "Energy producers are the direct beneficiary of a supply-driven price rise." },
      { symbol: "TUPRS", kind: "DIRECT", why: "Refining margins move with crude and product spreads." },
      { symbol: "THYAO", kind: "INDIRECT", why: "Fuel is among an airline's largest costs, so the exposure is negative." },
      { symbol: "XLI", kind: "INDIRECT", why: "Industrial input costs rise with energy." },
    ],
  },
  {
    id: "tr-policy",
    label: "Turkish policy shift",
    category: "Election",
    chainId: "tr-rates",
    exposures: [
      { symbol: "GARAN", kind: "DIRECT", why: "Bank margins respond immediately to the policy rate." },
      { symbol: "THYAO", kind: "INDIRECT", why: "Hard-currency revenue against a lira cost base." },
      { symbol: "SGOV", kind: "HEDGE", why: "USD cash appreciates in lira terms during a lira decline." },
    ],
  },
  {
    id: "supply-chain",
    label: "Supply-chain disruption",
    category: "Supply chain",
    exposures: [
      { symbol: "AAPL", kind: "DIRECT", why: "Concentrated assembly footprint with limited short-term flexibility." },
      { symbol: "TOASO", kind: "DIRECT", why: "Automotive assembly depends on just-in-time component flow." },
      { symbol: "XLI", kind: "INDIRECT", why: "Industrial production is gated by component availability." },
    ],
  },
];

/** Themes touching a ticker, for the ticker page. */
export function themesForAsset(symbol: string): {
  theme: WorldEventTheme;
  exposure: WorldEventTheme["exposures"][number];
}[] {
  const s = symbol.trim().toUpperCase();
  return WORLD_THEMES.flatMap((theme) => {
    const exposure = theme.exposures.find((e) => e.symbol === s);
    return exposure ? [{ theme, exposure }] : [];
  });
}
