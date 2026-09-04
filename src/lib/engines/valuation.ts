import type { CompanySnapshot } from "@/lib/data/normalize/company";
import { usableForValuation } from "@/lib/data/validation/company";

/**
 * Valuation Engine V2 (master spec §11–14).
 *
 * Deterministic multi-model fair value with a sanity layer. Never forces a
 * number: with unusable data it returns `verdict: "INVALID"` and the UI shows
 * VALUATION INVALID / DATA INCOMPLETE. All assumptions surface in the output
 * so the audit trail can diff two runs.
 */

export interface ModelResult {
  model: string;
  fairValue: number;
  weight: number;
  note: string;
}

export interface ValuationResult {
  symbol: string;
  verdict: "OK" | "INVALID";
  invalidReason?: string;
  price: number;
  base: number | null;
  bear: number | null;
  bull: number | null;
  upsidePct: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  models: ModelResult[];
  rejectedModels: Array<{ model: string; reason: string }>;
  assumptions: Record<string, number | string | null>;
  reasons: string[]; // WHY (≤5)
  risks: string[]; // ≤4
}

/**
 * Sector anchor multiples (base case) — deliberately coarse: they are the
 * PRIOR, blended with the company's own current multiple and the street's
 * forward view. Historical per-company medians can replace these once the
 * snapshot store has enough depth.
 */
export const SECTOR_PE: Record<CompanySnapshot["identity"]["companyType"], number> = {
  BANK: 12,
  INSURANCE: 12,
  REIT: 16,
  SEMICONDUCTOR: 22,
  SAAS: 28,
  ENERGY: 12,
  UTILITY: 17,
  CONSUMER: 20,
  INDUSTRIAL: 18,
  BIOTECH: 20,
  GENERAL: 18,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function computeValuation(snapshot: CompanySnapshot | null, price: number): ValuationResult {
  const base: ValuationResult = {
    symbol: snapshot?.identity.symbol ?? "?",
    verdict: "INVALID",
    invalidReason: "Data incomplete",
    price,
    base: null,
    bear: null,
    bull: null,
    upsidePct: null,
    confidence: "LOW",
    models: [],
    rejectedModels: [],
    assumptions: {},
    reasons: [],
    risks: [],
  };
  if (!usableForValuation(snapshot)) return base;
  if (!(price > 0)) return { ...base, invalidReason: "No valid market price" };

  const s = snapshot;

  // Currency gate: this engine prices .US quotes in USD. Fundamentals filed
  // in another currency (ADRs like TSM report TWD) would inflate every
  // per-share model by the FX rate — verified live before this guard existed.
  if (s.identity.currency !== null && s.identity.currency !== "USD") {
    return {
      ...base,
      invalidReason: `Reporting currency ${s.identity.currency} differs from USD quote — conversion not yet supported`,
    };
  }
  const t = s.identity.companyType;
  const models: ModelResult[] = [];
  const rejected: Array<{ model: string; reason: string }> = [];
  const assumptions: Record<string, number | string | null> = {
    companyType: t,
    dataConfidence: s.meta.confidence,
    statementPeriod: s.meta.period,
  };

  const shares = s.sharesOutstanding;
  const epsFwd = s.epsEstimateNextYear ?? s.epsEstimateCurrentYear;
  const anchorPe = SECTOR_PE[t];

  // ---- Model 1: forward P/E on street EPS ---------------------------------
  if (epsFwd !== null && epsFwd > 0) {
    // Blend: sector prior 40%, company's own current forward multiple 60% —
    // clamped into a sane band so one distorted input cannot run away.
    const ownFwd = s.forwardPe !== null && s.forwardPe > 0 ? clamp(s.forwardPe, 4, 60) : anchorPe;
    const mult = clamp(0.6 * ownFwd + 0.4 * anchorPe, 5, 45);
    models.push({
      model: "FWD_PE",
      fairValue: epsFwd * mult,
      weight: t === "BANK" || t === "REIT" ? 0.2 : 0.35,
      note: `${mult.toFixed(1)}× forward EPS ${epsFwd.toFixed(2)}`,
    });
    assumptions.fwdEps = epsFwd;
    assumptions.fwdMultiple = Number(mult.toFixed(2));
  } else {
    rejected.push({ model: "FWD_PE", reason: epsFwd === null ? "No forward EPS estimate" : "Negative forward EPS" });
  }

  // ---- Model 2: FCF yield ---------------------------------------------------
  if (
    t !== "BANK" && t !== "INSURANCE" &&
    s.freeCashFlowTtm !== null && s.freeCashFlowTtm > 0 &&
    shares !== null && shares > 0
  ) {
    const fcfPs = s.freeCashFlowTtm / shares;
    const targetYield = t === "SAAS" || t === "SEMICONDUCTOR" ? 0.028 : t === "ENERGY" ? 0.07 : 0.045;
    models.push({
      model: "FCF_YIELD",
      fairValue: fcfPs / targetYield,
      weight: 0.3,
      note: `FCF/sh ${fcfPs.toFixed(2)} at ${(targetYield * 100).toFixed(1)}% required yield`,
    });
    assumptions.fcfPerShare = Number(fcfPs.toFixed(2));
    assumptions.requiredFcfYield = targetYield;
  } else if (t !== "BANK" && t !== "INSURANCE") {
    rejected.push({ model: "FCF_YIELD", reason: "FCF or share count unavailable/negative" });
  }

  // ---- Model 3: EV/EBITDA re-rating ----------------------------------------
  if (
    t !== "BANK" && t !== "INSURANCE" &&
    s.ebitdaTtm !== null && s.ebitdaTtm > 0 &&
    s.evToEbitda !== null && s.evToEbitda > 0 &&
    s.enterpriseValue !== null && shares !== null && shares > 0 && s.netDebt !== null
  ) {
    const sectorEv = t === "SAAS" ? 22 : t === "SEMICONDUCTOR" ? 16 : t === "ENERGY" ? 6 : t === "REIT" ? 18 : 12;
    const mult = clamp(0.5 * clamp(s.evToEbitda, 3, 40) + 0.5 * sectorEv, 4, 35);
    const impliedEquity = s.ebitdaTtm * mult - s.netDebt;
    if (impliedEquity > 0) {
      models.push({
        model: "EV_EBITDA",
        fairValue: impliedEquity / shares,
        weight: 0.2,
        note: `${mult.toFixed(1)}× EBITDA − net debt`,
      });
      assumptions.evEbitdaMultiple = Number(mult.toFixed(2));
    } else {
      rejected.push({ model: "EV_EBITDA", reason: "Net debt exceeds implied enterprise value" });
    }
  }

  // ---- Model 4: P/B × justified (banks/insurance/REIT book-anchored) --------
  if ((t === "BANK" || t === "INSURANCE") && s.bookValuePerShare !== null && s.bookValuePerShare > 0) {
    const roe = s.roe;
    // Justified P/B ≈ ROE/COE prior (COE 10%); clamp 0.6–2.5.
    const justified = roe !== null && roe > 0 ? clamp(roe / 0.1, 0.6, 2.5) : 1.0;
    models.push({
      model: "P_B_JUSTIFIED",
      fairValue: s.bookValuePerShare * justified,
      weight: 0.45,
      note: `${justified.toFixed(2)}× book ${s.bookValuePerShare.toFixed(2)} (ROE ${(roe !== null ? roe * 100 : NaN).toFixed(0)}%)`,
    });
    assumptions.justifiedPb = Number(justified.toFixed(2));
  }

  // ---- Model 5: analyst target (sanity-screened) -----------------------------
  if (s.analystTargetPrice !== null && s.analystTargetPrice > 0) {
    const ratio = s.analystTargetPrice / price;
    // A target >2.2× or <0.45× price is treated as a data outlier (verified
    // real case: EODHD MU target 4×+ price), not as information.
    if (ratio > 0.45 && ratio < 2.2) {
      models.push({
        model: "STREET_TARGET",
        fairValue: s.analystTargetPrice,
        weight: 0.15,
        note: `Street consensus target`,
      });
      assumptions.streetTarget = s.analystTargetPrice;
    } else {
      rejected.push({ model: "STREET_TARGET", reason: `Target ${s.analystTargetPrice.toFixed(0)} is ${(ratio).toFixed(1)}× price — outlier` });
    }
  }

  if (models.length === 0) {
    return { ...base, verdict: "INVALID", invalidReason: "No valuation model had valid inputs", rejectedModels: rejected };
  }

  // ---- Blend + scenario band --------------------------------------------------
  const wsum = models.reduce((x, m) => x + m.weight, 0);
  const baseFv = models.reduce((x, m) => x + m.fairValue * (m.weight / wsum), 0);

  // Scenario band from estimate dispersion when available, else ±ATR-ish 15%.
  const nextEst = s.forwardEstimates.find((e) => e.epsAvg !== null && e.epsLow !== null && e.epsHigh !== null);
  let bear: number;
  let bull: number;
  if (nextEst && nextEst.epsAvg && nextEst.epsAvg > 0) {
    const lowRatio = clamp((nextEst.epsLow ?? nextEst.epsAvg) / nextEst.epsAvg, 0.5, 1);
    const highRatio = clamp((nextEst.epsHigh ?? nextEst.epsAvg) / nextEst.epsAvg, 1, 1.6);
    bear = baseFv * (0.85 * lowRatio + 0.15);
    bull = baseFv * (0.85 * highRatio + 0.15);
    assumptions.estimateDispersion = `${lowRatio.toFixed(2)}–${highRatio.toFixed(2)}`;
  } else {
    bear = baseFv * 0.85;
    bull = baseFv * 1.15;
  }

  // ---- Final sanity gate --------------------------------------------------------
  const upside = (baseFv - price) / price;

  // Hard absurdity gate (spec §11): a blended fair value beyond ±150% of a
  // live market price means an INPUT is broken (share-class EPS basis,
  // unit slip, wrong share count) — verified live on BRK-B where per-A-share
  // estimates inflated the model 600×. Publish INVALID, never the number.
  if (Math.abs(upside) > 1.5) {
    return {
      ...base,
      verdict: "INVALID",
      invalidReason: `Model output ${(upside * 100).toFixed(0)}% from price — inputs inconsistent (share basis / units)`,
      rejectedModels: rejected,
      models: models.map((m) => ({ ...m, fairValue: Number(m.fairValue.toFixed(2)) })),
      assumptions,
    };
  }

  let confidence: ValuationResult["confidence"] =
    s.meta.confidence === "HIGH" && models.length >= 3 ? "HIGH"
    : s.meta.confidence === "INVALID" ? "LOW"
    : models.length >= 2 ? "MEDIUM" : "LOW";
  if (Math.abs(upside) > 0.8) {
    // ±80%+ against a live price needs extraordinary evidence; we don't have a
    // mechanism to establish that yet, so we cap confidence, never the number.
    confidence = "LOW";
  }

  // ---- Reasons / risks (deterministic bullets) -----------------------------------
  const reasons: string[] = [];
  const risks: string[] = [];
  if (s.revenueGrowthYoY !== null && s.revenueGrowthYoY > 0.1)
    reasons.push(`Revenue growing ${(s.revenueGrowthYoY * 100).toFixed(0)}% YoY`);
  if (s.netMarginTtm !== null && s.netMarginTtm > 0.15)
    reasons.push(`Strong net margin ${(s.netMarginTtm * 100).toFixed(0)}%`);
  if (s.fcfYield !== null && s.fcfYield > 0.04)
    reasons.push(`FCF yield ${(s.fcfYield * 100).toFixed(1)}%`);
  if (s.forwardPe !== null && s.peTtm !== null && s.forwardPe < s.peTtm * 0.85)
    reasons.push(`Earnings expected to grow into the multiple (fwd P/E ${s.forwardPe.toFixed(1)} vs ${s.peTtm.toFixed(1)})`);
  if (s.netDebt !== null && s.netDebt < 0) reasons.push("Net cash balance sheet");

  if (s.netDebtToEbitda !== null && s.netDebtToEbitda > 3)
    risks.push(`Leverage ${s.netDebtToEbitda.toFixed(1)}× net debt/EBITDA`);
  if (s.revenueGrowthYoY !== null && s.revenueGrowthYoY < 0)
    risks.push(`Revenue shrinking ${(s.revenueGrowthYoY * 100).toFixed(0)}% YoY`);
  if (s.meta.issues.length > 0) risks.push(`Data: ${s.meta.issues[0]}`);
  if (nextEst?.analystCount !== null && nextEst !== undefined && (nextEst.analystCount ?? 0) < 5)
    risks.push("Thin analyst coverage");
  if (t === "SEMICONDUCTOR") risks.push("Cyclical end-market");

  return {
    symbol: s.identity.symbol,
    verdict: "OK",
    price,
    base: Number(baseFv.toFixed(2)),
    bear: Number(bear.toFixed(2)),
    bull: Number(bull.toFixed(2)),
    upsidePct: Number((upside * 100).toFixed(1)),
    confidence,
    models: models.map((m) => ({ ...m, fairValue: Number(m.fairValue.toFixed(2)) })),
    rejectedModels: rejected,
    assumptions,
    reasons: reasons.slice(0, 5),
    risks: risks.slice(0, 4),
  };
}
