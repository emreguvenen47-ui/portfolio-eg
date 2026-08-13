/**
 * Currency compounding.
 *
 * Sign convention used everywhere in this app:
 *   `usdTryChange` is the percentage change in the USD/TRY *rate*.
 *   +0.25 means the rate went 40 -> 50, i.e. the lira weakened.
 */

/** A USD asset, measured in TRY: (1 + r_usd)(1 + Δusdtry) - 1 */
export function tryReturnOfUsdAsset(usdReturn: number, usdTryChange: number): number {
  return (1 + usdReturn) * (1 + usdTryChange) - 1;
}

/** A TRY asset, measured in USD: (1 + r_try)/(1 + Δusdtry) - 1 */
export function usdReturnOfTryAsset(tryReturn: number, usdTryChange: number): number {
  if (1 + usdTryChange === 0) return 0;
  return (1 + tryReturn) / (1 + usdTryChange) - 1;
}

/**
 * PPF (Turkish money-market fund) translated into USD.
 * Same maths as `usdReturnOfTryAsset`, named separately because PPF is the
 * only holding where the TL yield is an input rather than a market price.
 */
export function ppfUsdReturn(tlReturn: number, usdTryChange: number): number {
  return usdReturnOfTryAsset(tlReturn, usdTryChange);
}

/**
 * The USD/TRY move at which a TL yield exactly breaks even in USD.
 * Solving (1+tl)/(1+x) - 1 = 0 gives x = tl.
 */
export const breakEvenUsdTryChange = (tlReturn: number): number => tlReturn;

export interface PpfScenario {
  label: string;
  usdTryChange: number;
  usdReturn: number;
  atRisk: boolean;
}

/**
 * @param tlYield          annual TL yield, e.g. 0.35
 * @param scenarioChanges  USD/TRY rate moves to evaluate, e.g. [0.05, 0.10, 0.20, 0.30]
 */
export function ppfScenarios(tlYield: number, scenarioChanges: number[]): PpfScenario[] {
  return scenarioChanges.map((chg) => {
    const usdReturn = ppfUsdReturn(tlYield, chg);
    return {
      label: `USD/TRY ${chg >= 0 ? "+" : ""}${(chg * 100).toFixed(0)}%`,
      usdTryChange: chg,
      usdReturn,
      atRisk: usdReturn < 0,
    };
  });
}

/** Converts a value in `from` currency into USD using a USD-base rate table. */
export function toUsd(
  amount: number,
  from: "USD" | "TRY" | "EUR" | "MIXED",
  rates: { usdTry: number; eurUsd: number },
): number {
  switch (from) {
    case "TRY":
      return rates.usdTry > 0 ? amount / rates.usdTry : amount;
    case "EUR":
      return amount * rates.eurUsd;
    default:
      return amount;
  }
}

/** Annual rate -> the equivalent rate over `days` (compounded). */
export const prorate = (annualRate: number, days: number): number =>
  (1 + annualRate) ** (days / 365) - 1;
