import type { Portfolio, Thesis, ThesisStatus } from "@/lib/types";

/**
 * Thesis records are seeded FROM THE WORKBOOK: the "NEDEN ALDIK" column becomes
 * the thesis and drivers, the "RİSKLER" column becomes the risk list. Only the
 * fields Excel cannot express — status, confidence, invalidation trigger and
 * the indicators to watch — come from the map below, and each falls back to a
 * generic default so an imported workbook still produces usable records.
 */

interface ThesisOverlay {
  status: ThesisStatus;
  confidence: number;
  invalidation: string;
  keyIndicators: string[];
}

const OVERLAYS: Record<string, ThesisOverlay> = {
  PPF: {
    status: "GREEN",
    confidence: 78,
    invalidation:
      "Realised USD/TRY depreciation exceeds the TL yield for two consecutive quarters, turning the real carry negative in USD.",
    keyIndicators: ["TCMB policy rate", "TR CPI (monthly)", "USD/TRY", "Real rate vs CPI"],
  },
  BIST: {
    status: "YELLOW",
    confidence: 58,
    invalidation:
      "TCMB resumes hiking, or the disinflation trend reverses for three consecutive months, removing the rate-cut catalyst.",
    keyIndicators: ["TCMB policy rate", "TR CPI", "XU100 in USD", "Foreign flows"],
  },
  RSP: {
    status: "GREEN",
    confidence: 74,
    invalidation:
      "Equal-weight underperforms cap-weight by more than 15% over a rolling 12 months, indicating concentration is structural rather than cyclical.",
    keyIndicators: ["RSP vs SPY spread", "S&P top-10 weight", "Fed path", "Earnings breadth"],
  },
  QQQ: {
    status: "YELLOW",
    confidence: 62,
    invalidation:
      "Two or more hyperscalers cut capex guidance, or NDX forward P/E expands beyond 35x without matching earnings revisions.",
    keyIndicators: ["Hyperscaler capex guidance", "NDX forward P/E", "US 10Y", "Earnings revisions"],
  },
  SMH: {
    status: "YELLOW",
    confidence: 60,
    invalidation:
      "HBM or foundry pricing rolls over, or AI capex growth decelerates below 20% year over year.",
    keyIndicators: ["HBM pricing", "TSMC monthly revenue", "Export controls", "Book-to-bill"],
  },
  XLI: {
    status: "GREEN",
    confidence: 71,
    invalidation:
      "Electrical-equipment order backlogs shorten materially, or datacenter interconnect projects are widely deferred.",
    keyIndicators: ["Eaton/Quanta backlog", "ISM Manufacturing", "Datacenter capex", "Copper"],
  },
  VGK: {
    status: "YELLOW",
    confidence: 55,
    invalidation:
      "The European fiscal and defence capex cycle stalls, or the US-Europe valuation gap closes without earnings follow-through.",
    keyIndicators: ["EU defence budgets", "German fiscal impulse", "ECB path", "EUR/USD"],
  },
  KWEB: {
    status: "YELLOW",
    confidence: 42,
    invalidation:
      "A repeat of a 2021-style regulatory intervention, or renewed delisting pressure on US-listed Chinese ADRs.",
    keyIndicators: ["Regulatory headlines", "Tariff policy", "China stimulus", "ADR delisting risk"],
  },
  EMXC: {
    status: "GREEN",
    confidence: 66,
    invalidation:
      "The dollar enters a sustained uptrend (DXY above 108) or tariff escalation breaks the supply-chain-winner thesis.",
    keyIndicators: ["DXY", "Fed path", "EM earnings revisions", "Tariff policy"],
  },
  GLDM: {
    status: "GREEN",
    confidence: 80,
    invalidation:
      "US real yields rise durably above 3% while central-bank net buying turns negative.",
    keyIndicators: ["US 10Y real yield", "Central bank purchases", "DXY", "ETF flows"],
  },
  CPER: {
    status: "GREEN",
    confidence: 69,
    invalidation:
      "Chinese property demand deteriorates further while mine supply surprises to the upside, pushing the market into surplus.",
    keyIndicators: ["LME inventories", "China property starts", "Mine supply guidance", "Grid capex"],
  },
};

const GENERIC: ThesisOverlay = {
  status: "YELLOW",
  confidence: 50,
  invalidation: "Not yet defined — set an explicit invalidation condition for this position.",
  keyIndicators: ["Price vs 200DMA", "Relative strength", "Sector flows"],
};

/** Splits the workbook's free text into readable bullet points. */
function toBullets(text: string, limit = 5): string[] {
  if (!text) return [];
  return text
    .split(/(?:\n|\.\s+(?=[A-ZÇĞİÖŞÜ★])|·|;)/g)
    .map((s) => s.replace(/^[★•\-\s]+/, "").trim())
    .filter((s) => s.length > 18)
    .slice(0, limit)
    .map((s) => (s.endsWith(".") ? s : `${s}.`));
}

function firstSentences(text: string, count = 2): string {
  if (!text) return "";
  const parts = text.split(/(?<=\.)\s+/).filter(Boolean);
  return parts.slice(0, count).join(" ").trim();
}

export function buildTheses(portfolio: Portfolio, reviewDate = new Date()): Thesis[] {
  return portfolio.positions.map((p) => {
    const overlay = OVERLAYS[p.code.toUpperCase()] ?? GENERIC;
    const isUnallocated = p.assetClass === "Unallocated";

    return {
      code: p.code,
      thesis: firstSentences(p.rationale) || p.name,
      drivers: toBullets(p.rationale),
      risks: toBullets(p.risks),
      status: isUnallocated ? "YELLOW" : overlay.status,
      confidence: isUnallocated ? 40 : overlay.confidence,
      invalidation: isUnallocated
        ? "Sleeve remains unallocated past its decision date, turning temporary cash into a permanent drag."
        : overlay.invalidation,
      keyIndicators: isUnallocated
        ? ["Decision deadline", "Cash drag vs benchmark", "Drawdown opportunities"]
        : overlay.keyIndicators,
      lastReview: reviewDate.toISOString().slice(0, 10),
      notes: p.category ? `Workbook category: ${p.category}.` : "",
    } satisfies Thesis;
  });
}

export const THESIS_STATUS_COLOR: Record<ThesisStatus, string> = {
  GREEN: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  YELLOW: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  RED: "text-rose-400 border-rose-500/40 bg-rose-500/10",
};
