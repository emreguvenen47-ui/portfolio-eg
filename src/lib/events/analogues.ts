import type { EventKind } from "./playbook";

/**
 * Historical analogues.
 *
 * "What happened last time" is only useful if last time was actually
 * comparable. A Fed cut delivered into a healthy expansion and a Fed cut
 * delivered into a collapsing labour market are the same headline and opposite
 * trades, so pooling them produces a median that describes neither.
 *
 * Each cohort below is therefore a hand-curated set of dates with a stated
 * reason for membership. Dates are the actual announcement days. The reactions
 * are then measured from real closes by the existing event-study engine — this
 * module supplies only the question, never the answer.
 *
 * Nothing here claims causality. A median move after an event is a description
 * of a sample, not a mechanism, and the UI says so.
 */

export interface Cohort {
  id: string;
  kind: EventKind;
  label: string;
  /** Why these occasions belong together. */
  rationale: string;
  /** Announcement dates, yyyy-mm-dd. */
  dates: string[];
}

export const COHORTS: Cohort[] = [
  {
    id: "fed-normalisation-cuts",
    kind: "FOMC",
    label: "Normalisation cuts",
    rationale:
      "Cuts delivered with the labour market intact and no recession under way — policy easing off a restrictive setting rather than responding to a downturn. Historically the friendlier of the two cut regimes for equities.",
    dates: [
      "1995-07-06",
      "1995-12-19",
      "1996-01-31",
      "1998-09-29",
      "1998-10-15",
      "1998-11-17",
      "2019-07-31",
      "2019-09-18",
      "2019-10-30",
      "2024-09-18",
      "2024-11-07",
      "2024-12-18",
    ],
  },
  {
    id: "fed-recession-cuts",
    kind: "FOMC",
    label: "Recession / growth-scare cuts",
    rationale:
      "Cuts delivered into a deteriorating economy or an acute financial event. The cut itself was a symptom; equities generally kept falling for months afterwards.",
    dates: [
      "2001-01-03",
      "2001-03-20",
      "2001-04-18",
      "2001-09-17",
      "2007-09-18",
      "2008-01-22",
      "2008-03-18",
      "2008-10-08",
      "2008-12-16",
      "2020-03-03",
      "2020-03-15",
    ],
  },
  {
    id: "fed-hikes",
    kind: "FOMC",
    label: "Tightening cycle hikes",
    rationale:
      "Rate increases during an active tightening cycle. Grouped separately because the equity and bond reaction to a hike is not the mirror image of the reaction to a cut.",
    dates: [
      "2016-12-14",
      "2017-03-15",
      "2017-06-14",
      "2017-12-13",
      "2018-03-21",
      "2018-06-13",
      "2018-09-26",
      "2018-12-19",
      "2022-03-16",
      "2022-05-04",
      "2022-06-15",
      "2022-07-27",
      "2022-09-21",
      "2022-11-02",
      "2022-12-14",
      "2023-02-01",
      "2023-03-22",
      "2023-05-03",
      "2023-07-26",
    ],
  },
  {
    id: "cpi-upside",
    kind: "US_CPI",
    label: "Upside CPI surprises",
    rationale:
      "Releases where headline inflation came in materially above consensus and the market repriced the policy path on the day.",
    dates: [
      "2021-05-12",
      "2021-06-10",
      "2021-10-13",
      "2022-01-12",
      "2022-02-10",
      "2022-06-10",
      "2022-09-13",
      "2024-01-11",
      "2024-04-10",
    ],
  },
  {
    id: "cpi-downside",
    kind: "US_CPI",
    label: "Downside CPI surprises",
    rationale:
      "Releases where inflation undershot consensus, typically producing the sharpest positive equity and bond reactions of the cycle.",
    dates: [
      "2022-11-10",
      "2022-12-13",
      "2023-06-13",
      "2023-11-14",
      "2024-05-15",
      "2024-07-11",
    ],
  },
  {
    id: "nfp-weak",
    kind: "US_NFP",
    label: "Weak payroll prints",
    rationale:
      "Employment reports well below consensus. Worth separating because a weak print is read as dovish in a tightening cycle and as recessionary in a loosening one.",
    dates: [
      "2021-05-07",
      "2021-09-03",
      "2022-12-02",
      "2024-08-02",
      "2024-09-06",
    ],
  },
];

export const cohortsFor = (kind: EventKind): Cohort[] =>
  COHORTS.filter((c) => c.kind === kind);

/**
 * Last release figures.
 *
 * No configured provider carries an economic calendar with consensus and
 * actuals — Finnhub's calendar endpoints are not on this plan. Rather than
 * scrape a figure whose vintage and revision status we could not verify, the
 * shape is defined here and left empty. A provider only has to implement
 * `ReleaseSource` to fill it.
 */
export interface Release {
  /** The period the figure describes, e.g. "2026-07". */
  period: string;
  releasedAt: string;
  previous: number | null;
  consensus: number | null;
  actual: number | null;
  /** actual − consensus, in the series' own units. */
  surprise: number | null;
  unit: string;
}

export interface ReleaseSource {
  name: string;
  lastRelease(kind: EventKind): Promise<Release | null>;
}

const SOURCES: ReleaseSource[] = [];

export function registerReleaseSource(s: ReleaseSource): void {
  SOURCES.push(s);
}

export async function getLastRelease(
  kind: EventKind,
): Promise<{ release: Release | null; note: string }> {
  for (const s of SOURCES) {
    try {
      const r = await s.lastRelease(kind);
      if (r) return { release: r, note: `Release data from ${s.name}.` };
    } catch {
      // Try the next source rather than failing the page.
    }
  }
  return {
    release: null,
    note: "No configured provider carries an economic calendar with consensus and actual prints, so previous/consensus/actual read N/A. The market reactions below are measured from real closes and are unaffected.",
  };
}
