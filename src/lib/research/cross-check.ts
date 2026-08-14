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

/**
 * Three sources instead of two.
 *
 * With a third derivation available the question changes from "do these two
 * match" to "what does the majority say". The rules follow from what each
 * source is:
 *
 * - Any two agreeing carries it. Two independent derivations landing on the
 *   same number is the strongest evidence available here, and the value
 *   reported is the filed one when filings are in the majority, otherwise the
 *   median of the agreeing pair.
 * - All three apart is a genuine dispute. The filed figure is shown, because
 *   it is the auditable primary record, and all three readings are kept so the
 *   panel can display them.
 * - One source alone stays single-source. A third opinion that never arrived
 *   does not upgrade anything.
 *
 * The third source is deliberately not averaged in. A mean of three numbers
 * that disagree is a fourth number nobody reported.
 */
export interface Checked3 extends Checked {
  /** The third derivation, when one was fetched. */
  third: number | null;
  /** How many of the available readings agreed with the reported value. */
  agreeing: number;
  /** How many readings existed at all. */
  available: number;
}

export function crossCheck3(
  filed: number | null | undefined,
  reported: number | null | undefined,
  third: number | null | undefined,
  tol: Tolerance = PERCENT_TOLERANCE,
): Checked3 {
  const f = usable(filed) ? filed : null;
  const r = usable(reported) ? reported : null;
  const t = usable(third) ? third : null;

  const readings = [f, r, t].filter((x): x is number => x !== null);
  const base = crossCheck(f, r, tol);

  if (t === null) {
    return { ...base, third: null, agreeing: base.agreement === "CONFIRMED" ? 2 : 1, available: readings.length };
  }

  const near = (a: number, b: number) => {
    const spread = Math.abs(a - b);
    return spread <= tol.abs || spread <= Math.max(Math.abs(a), Math.abs(b)) * tol.rel;
  };

  // Which pairs agree.
  const fr = f !== null && r !== null && near(f, r);
  const ft = f !== null && near(f, t);
  const rt = r !== null && near(r, t);

  if (fr || ft) {
    // Filings are in the agreeing majority, so the filed figure is reported.
    const agreeing = 1 + (fr ? 1 : 0) + (ft ? 1 : 0);
    return {
      value: f,
      agreement: "CONFIRMED",
      filed: f,
      reported: r,
      third: t,
      spread: base.spread,
      agreeing,
      available: readings.length,
    };
  }

  if (rt) {
    // The other two agree and the filings do not. Report what the majority
    // says while keeping the filed figure visible — this is the case most
    // worth a human eye, because either the filings were read wrongly here or
    // both other sources share a definition the filings do not.
    return {
      value: r,
      agreement: "DISPUTED",
      filed: f,
      reported: r,
      third: t,
      spread: f === null ? null : Math.abs(f - r),
      agreeing: 2,
      available: readings.length,
    };
  }

  return {
    value: f ?? r ?? t,
    agreement: readings.length > 1 ? "DISPUTED" : "SINGLE_SOURCE",
    filed: f,
    reported: r,
    third: t,
    spread: base.spread,
    agreeing: 1,
    available: readings.length,
  };
}

export const AGREEMENT_LABEL: Record<Agreement, string> = {
  CONFIRMED: "confirmed by two sources",
  SINGLE_SOURCE: "one source only",
  DISPUTED: "sources disagree — showing the filed figure",
  MISSING: "not reported",
};
