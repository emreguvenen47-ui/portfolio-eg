/**
 * Black-Scholes greeks, computed from the chain's own implied volatility.
 *
 * WHAT IS AND IS NOT MODELLED HERE, because the distinction is the whole point:
 *
 * The inputs are all observed — strike, expiry and implied volatility come
 * from the venue's listing, the spot from the underlying quote, the rate from
 * a short Treasury yield. The greeks are the textbook partial derivatives of
 * the Black-Scholes price with respect to those inputs. That is arithmetic on
 * published numbers, not a forecast, and every desk computes the same figures
 * the same way.
 *
 * What this does NOT do is invent a price. If the chain publishes no implied
 * volatility for a strike, the greeks are null. Solving for an IV that would
 * make the model agree with a stale last trade, and then presenting the
 * resulting delta as though it were measured, is exactly the kind of
 * plausible-looking fabrication this codebase refuses elsewhere.
 *
 * Dividends are not modelled. For a dividend-paying underlying that biases
 * call delta slightly high and put delta slightly low; `assumesNoDividend`
 * says so rather than leaving it for the reader to discover.
 */

export interface GreekInputs {
  /** Underlying price. */
  spot: number;
  strike: number;
  /** Years to expiry. */
  years: number;
  /** Annualised implied volatility, as a fraction — 0.25 for 25%. */
  iv: number;
  /** Annualised risk-free rate, as a fraction. */
  rate: number;
  type: "CALL" | "PUT";
}

export interface Greeks {
  /** Change in option price per 1.00 move in the underlying. */
  delta: number;
  /** Change in delta per 1.00 move in the underlying. */
  gamma: number;
  /** Change in option price per one percentage point of volatility. */
  vega: number;
  /** Change in option price per calendar day. */
  theta: number;
  /** Change in option price per one percentage point of rate. */
  rho: number;
  /** Model price at these inputs, for comparison with the quoted mark. */
  theoretical: number;
  assumesNoDividend: true;
}

/** Standard normal density. */
const pdf = (x: number): number => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/**
 * Standard normal CDF via Abramowitz & Stegun 26.2.17.
 *
 * Accurate to about 7.5e-8, which is far below the precision of the inputs —
 * an implied volatility quoted to four decimals does not justify anything
 * more elaborate.
 */
function cdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

/**
 * The lowest implied volatility worth believing.
 *
 * Outside market hours Yahoo publishes 0.00001 for strikes it has no live
 * quote for. That is a placeholder, not a measurement, and feeding it through
 * the formula produced a confident delta of 1.000 and a theoretical price four
 * dollars below the quoted mark — numbers that look computed because they
 * were, from an input that meant nothing. No listed equity option trades below
 * one percent implied.
 */
const MIN_CREDIBLE_IV = 0.01;

export function greeks(i: GreekInputs): Greeks | null {
  const { spot, strike, years, iv, rate, type } = i;

  // Every one of these makes the formula undefined or meaningless rather than
  // merely imprecise, so there is nothing honest to return.
  if (!(spot > 0) || !(strike > 0) || !(years > 0)) return null;
  if (!(iv >= MIN_CREDIBLE_IV)) return null;
  if (![spot, strike, years, iv, rate].every(Number.isFinite)) return null;

  const sqrtT = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate + (iv * iv) / 2) * years) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;

  const nd1 = cdf(d1);
  const nd2 = cdf(d2);
  const discount = Math.exp(-rate * years);

  const call = type === "CALL";
  const theoretical = call
    ? spot * nd1 - strike * discount * nd2
    : strike * discount * cdf(-d2) - spot * cdf(-d1);

  const delta = call ? nd1 : nd1 - 1;
  const gamma = pdf(d1) / (spot * iv * sqrtT);

  // Per one point of volatility and per one point of rate, not per unit —
  // that is how they are read on a desk, and a vega of 0.12 is easier to act
  // on than one of 12.
  const vega = (spot * pdf(d1) * sqrtT) / 100;
  const rho = (call ? strike * years * discount * nd2 : -strike * years * discount * cdf(-d2)) / 100;

  // Per calendar day rather than per year.
  const thetaAnnual = call
    ? -(spot * pdf(d1) * iv) / (2 * sqrtT) - rate * strike * discount * nd2
    : -(spot * pdf(d1) * iv) / (2 * sqrtT) + rate * strike * discount * cdf(-d2);
  const theta = thetaAnnual / 365;

  return { delta, gamma, vega, theta, rho, theoretical, assumesNoDividend: true };
}

/** Years between now and an expiry date, floored at one trading session. */
export function yearsToExpiry(expiry: string, from = new Date()): number {
  const end = Date.parse(`${expiry}T21:00:00Z`);
  const ms = end - from.getTime();
  // An option expiring today still has intraday value; treating it as zero
  // would divide by zero and report no greeks at all on expiry day.
  return Math.max(ms, 6 * 60 * 60_000) / (365 * 24 * 60 * 60_000);
}
