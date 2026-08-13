import type { StressScenario } from "@/lib/types";

/**
 * User-editable assumptions. These are NOT read from the workbook — they are
 * forward-looking inputs the user controls from the Settings and Currency
 * pages. Defaults are chosen to match the workbook's own commentary.
 */
export interface AppSettings {
  /** Annual TL yield on the money-market fund, e.g. 0.35 = 35%. */
  ppfTlYield: number;
  /** Expected 12m change in the USD/TRY *rate*. +0.28 = lira weakens 28%. */
  expectedUsdTryChange: number;
  /** Manual override for the current USD/TRY rate; null = use market data. */
  usdTryOverride: number | null;
  /** Cost basis is struck at this date. Default = start of the current year. */
  inceptionDate: string;
  riskFreeRate: number;
  benchmark: "SPX" | "XU100" | "NONE";
  /** Drift beyond which a position is flagged OVER/UNDERWEIGHT, in weight pts. */
  driftThreshold: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  ppfTlYield: 0.35,
  expectedUsdTryChange: 0.28,
  usdTryOverride: null,
  inceptionDate: `${new Date().getUTCFullYear()}-01-02`,
  riskFreeRate: 0.036,
  benchmark: "SPX",
  driftThreshold: 0.01,
};

export const TRY_STRESS_STEPS = [0.05, 0.1, 0.2, 0.3];

/** Seed scenarios. Users can edit shocks and add their own at runtime. */
export const DEFAULT_SCENARIOS: StressScenario[] = [
  {
    id: "turkey-crisis",
    name: "Turkey Crisis",
    description:
      "Lira shock with an equity sell-off. Gold rallies as the domestic hedge bid appears.",
    editable: true,
    shocks: [
      { target: "BIST", shockPct: -0.3 },
      { target: "USDTRY", shockPct: 0.25 },
      { target: "GLDM", shockPct: 0.1 },
    ],
  },
  {
    id: "ai-correction",
    name: "AI Correction",
    description:
      "AI capex disappointment. Semis lead the fall, industrials and copper follow.",
    editable: true,
    shocks: [
      { target: "QQQ", shockPct: -0.2 },
      { target: "SMH", shockPct: -0.35 },
      { target: "XLI", shockPct: -0.08 },
      { target: "CPER", shockPct: -0.15 },
    ],
  },
  {
    id: "global-crash",
    name: "Global Crash",
    description: "Broad risk-off across every equity region. Gold is the only hedge.",
    editable: true,
    shocks: [
      { target: "RSP", shockPct: -0.2 },
      { target: "QQQ", shockPct: -0.25 },
      { target: "SMH", shockPct: -0.25 },
      { target: "XLI", shockPct: -0.2 },
      { target: "VGK", shockPct: -0.18 },
      { target: "EMXC", shockPct: -0.2 },
      { target: "KWEB", shockPct: -0.2 },
      { target: "BIST", shockPct: -0.2 },
      { target: "CPER", shockPct: -0.15 },
      { target: "GLDM", shockPct: 0.1 },
    ],
  },
  {
    id: "soft-landing",
    name: "Soft Landing",
    description: "Disinflation without recession. Breadth improves and cyclicals lead.",
    editable: true,
    shocks: [
      { target: "RSP", shockPct: 0.15 },
      { target: "QQQ", shockPct: 0.12 },
      { target: "SMH", shockPct: 0.15 },
      { target: "XLI", shockPct: 0.12 },
      { target: "VGK", shockPct: 0.12 },
      { target: "EMXC", shockPct: 0.15 },
    ],
  },
];

export interface AlertRule {
  id: string;
  label: string;
  kind: "weight" | "market" | "drawdown" | "fx" | "ma";
  target: string;
  op: ">" | "<";
  threshold: number;
  unit: "pct" | "level" | "weight";
  enabled: boolean;
}

export const DEFAULT_ALERTS: AlertRule[] = [
  { id: "smh-weight", label: "SMH weight above 6%", kind: "weight", target: "SMH", op: ">", threshold: 0.06, unit: "weight", enabled: true },
  { id: "vix-30", label: "VIX above 30", kind: "market", target: "VIX", op: ">", threshold: 30, unit: "level", enabled: true },
  { id: "usdtry-3", label: "USD/TRY daily move above 3%", kind: "fx", target: "USDTRY", op: ">", threshold: 3, unit: "pct", enabled: true },
  { id: "qqq-200dma", label: "QQQ more than 10% below its 200DMA", kind: "ma", target: "QQQ", op: "<", threshold: -10, unit: "pct", enabled: true },
  { id: "drawdown-10", label: "Portfolio drawdown beyond 10%", kind: "drawdown", target: "PORTFOLIO", op: "<", threshold: -10, unit: "pct", enabled: true },
];
