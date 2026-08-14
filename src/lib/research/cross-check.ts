/**
 * Agreement between two independent measurements of the same figure.
 *
 * WHY THIS EXISTS: margins, returns and growth were read from whichever source
 * answered first — in practice the provider's precomputed metric bag, with the
 * value derived from filings used only as a fallback. That is one source
 * wearing the appearance of certainty, and it has been wrong here before: a
 * bank's revenue growth came back at +109% because the provider was measuring
 * gross interest income.
 *
 * So both are computed and compared. The rules:
 *
 * - Agree → report it, and say it was confirmed twice. This is the case the
 *   user can trust most, and it is worth marking as different from the rest.
 * - Only one available → report it, marked single-source. Still useful; just
 *   not corroborated.
 * - Disagree → report the FILED figure, and say the two disagree, with both
 *   numbers. Filings win because they are the auditable primary record and a
 *   provider's ratio carries definitional choices nobody stated.
 *
 * What this deliberately does not do is average them. A mean of two numbers
 * that disagree is a third number that neither source supports.
 */

export type Agreement = "CONFIRMED" | "SINGLE_SOURCE" | "DISPUTED" | "MISSING";

export interface Checked {
  value: number | null;
  agreement: Agreement;
  /** Computed from filed statements. */
  filed: number | null;
  /** Taken from the provider's precomputed metric. */
  reported: number | null;
  /** Absolute difference, when both exist. */
  spread: number | null;
}

/**
 * How far apart two readings may be and still count as the same number.
 *
 * Generous on purpose. The two paths legitimately differ on trailing-window
 * boundaries and on whether a one-off is in operating income, and flagging
 * every such difference as a dispute would make the marker meaningless. What
 * it is meant to catch is a definitional mismatch — the kind that produces
 * 109% against 6%, not 22.4% against 22.1%.
 */
export interface Tolerance {
  /** Allowed absolute gap, in the metric's own units. */
  abs: number;
  /** Allowed gap as a fraction of the larger magnitude. */
  rel: number;
}

export const PERCENT_TOLERANCE: Tolerance = { abs: 1.5, rel: 0.1 };
export const RATIO_TOLERANCE: Tolerance = { abs: 0.15, rel: 0.1 };
/** Growth swings legitimately; only a definitional gap should trip this. */
export const GROWTH_TOLERANCE: Tolerance = { abs: 4, rel: 0.25 };

const usable = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function crossCheck(
  filed: number | null | undefined,
  reported: number | null | undefined,
  tol: Tolerance = PERCENT_TOLERANCE,
): Checked {
  const f = usable(filed) ? filed : null;
  const r = usable(reported) ? reported : null;

  if (f === null && r === null) {
    return { value: null, agreement: "MISSING", filed: null, reported: null, spread: null };
  }

  if (f === null || r === null) {
    return {
      value: (f ?? r) as number,
      agreement: "SINGLE_SOURCE",
      filed: f,
      reported: r,
      spread: null,
    };
  }

  const spread = Math.abs(f - r);
  const scale = Math.max(Math.abs(f), Math.abs(r));
  const agrees = spread <= tol.abs || spread <= scale * tol.rel;

  return {
    // On disagreement the filed figure wins: it is the primary record, and
    // it is the one whose derivation this codebase can show.
    value: agrees ? f : f,
    agreement: agrees ? "CONFIRMED" : "DISPUTED",
    filed: f,
    reported: r,
    spread,
  };
}

/** Shorthand when only the number is wanted. */
export const checkedValue = (
  filed: number | null | undefined,
  reported: number | null | undefined,
  tol?: Tolerance,
): number | null => crossCheck(filed, reported, tol).value;

export const AGREEMENT_LABEL: Record<Agreement, string> = {
  CONFIRMED: "confirmed by two sources",
  SINGLE_SOURCE: "one source only",
  DISPUTED: "sources disagree — showing the filed figure",
  MISSING: "not reported",
};
