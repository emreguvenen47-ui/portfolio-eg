import "@/lib/providers/register";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Chip, Empty, Note, Panel } from "@/components/shell/ui";
import { getContext } from "@/lib/server/context";
import { getHistories } from "@/lib/providers";
import { buildCalendar, runEventStudy } from "@/lib/events/calendar";
import { cohortsFor, getLastRelease } from "@/lib/events/analogues";
import { getEventProbabilities } from "@/lib/providers/polymarket";
import { MARKET_MATCHERS } from "@/lib/events/market-match";
import {
  DIRECTION_LABEL,
  DIRECTION_WEIGHT,
  TEMPLATES,
  type Direction,
} from "@/lib/events/playbook";
import { fmtPctPoints, signClass } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const CELL: Record<Direction, string> = {
  "++": "text-emerald-400 font-semibold",
  "+": "text-emerald-400/80",
  "0": "text-[var(--ink-3)]",
  "-": "text-rose-400/80",
  "--": "text-rose-400 font-semibold",
};

/** Assets the historical study measures. Kept small — one request, real data. */
// XU100 included so Turkish exposure gets a real reaction row too.
const STUDY_ASSETS = ["SPX", "NDX", "GLDM", "US10Y", "DXY", "US2Y", "XU100"];

export default async function EventPlaybook(props: PageProps<"/events/[id]">) {
  const { id } = await props.params;
  const eventId = decodeURIComponent(id);

  const calendar = buildCalendar(24, 6);
  const event = calendar.find((e) => e.id === eventId);
  if (!event) notFound();

  const tpl = TEMPLATES[event.kind];
  const released = event.date < new Date().toISOString().slice(0, 10);

  const [ctx, histories] = await Promise.all([
    getContext({ markets: true }).catch(() => null),
    getHistories(STUDY_ASSETS, 1300).catch(() => ({})),
  ]);

  const series = Object.fromEntries(
    Object.entries(histories).map(([k, v]) => [
      k,
      v.candles.map((c) => ({ date: c.date, close: c.close })),
    ]),
  );

  // Past occurrences of THIS event type, measured on real prices.
  const pastDates = calendar
    .filter((e) => e.kind === event.kind && e.date < new Date().toISOString().slice(0, 10))
    .map((e) => e.date)
    .slice(-8);
  const study = runEventStudy(pastDates, series);

  // Cohort studies: the same measurement, restricted to genuinely comparable
  // past occasions. Pooling a normalisation cut with a recession cut produces
  // a median that describes neither.
  const cohorts = cohortsFor(event.kind).map((c) => ({
    cohort: c,
    study: runEventStudy(c.dates, series),
  }));

  /** Release figures carry their own unit; render with it rather than raw. */
  const fmtRelease = (v: number | null | undefined, unit: string): string => {
    if (v === null || v === undefined || !Number.isFinite(v)) return "N/A";
    const digits = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
    const sign = v > 0 && (unit.includes("%") || unit.includes("jobs")) ? "+" : "";
    return `${sign}${v.toFixed(digits)}${unit.startsWith("%") ? unit : ` ${unit}`}`;
  };

  const [{ release, note: releaseNote }, implied] = await Promise.all([
    getLastRelease(event.kind),
    getEventProbabilities(`${event.kind}:${event.date}`, {
      ...MARKET_MATCHERS[event.kind],
      // Gate on the meeting/release date so a market about a different
      // occurrence of the same event cannot be attached to this one.
      resolvesNear: event.date,
      windowDays: 21,
    }),
  ]);

  // Exposure that carries meaningful sensitivity under each scenario.
  const rows = ctx?.rows ?? [];
  const exposureFor = (reactions: Record<string, Direction>) => {
    let positive = 0;
    let negative = 0;
    for (const r of rows) {
      const d = reactions[r.position.code.toUpperCase()];
      if (!d) continue;
      const w = DIRECTION_WEIGHT[d];
      if (w > 0) positive += r.currentWeight;
      else if (w < 0) negative += r.currentWeight;
    }
    return { positive, negative };
  };

  const matrixCodes = tpl.relevantPositions;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/events" className="text-[11px] text-[var(--ink-3)] hover:text-[var(--amber)]">
          ← Events
        </Link>
        <h1 className="text-[16px] font-semibold">{tpl.title}</h1>
        <Chip tone={event.importance === "HIGH" ? "neg" : "warn"}>{event.importance}</Chip>
        <Chip tone={released ? "neutral" : "info"}>
          {released ? "EVENT REVIEW" : "UPCOMING"}
        </Chip>
        <span className="ml-auto text-[10px] text-[var(--ink-3)]">
          {event.date} · {event.source}
        </span>
      </div>

      <Note tone="warn">
        <span>
          Scenario directions are <strong>stated sensitivities</strong>, not predictions or
          probabilities. Nothing on this page forecasts the outcome.
        </span>
      </Note>

      {/* ------------------------------------------------------- overview */}
      <Panel title="Last Release" bodyClassName="p-0">
        <table className="grid-table">
          <tbody>
            <tr>
              <td className="tl w-[180px]">Period</td>
              <td className="tl">{release?.period ?? "N/A"}</td>
            </tr>
            <tr>
              <td className="tl">Previous</td>
              <td className="tl tabular-nums">
                {release ? fmtRelease(release.previous, release.unit) : (event.previous ?? "N/A")}
              </td>
            </tr>
            <tr>
              <td className="tl">Consensus</td>
              <td className="tl tabular-nums text-[var(--ink-3)]">
                {release?.consensus == null ? "N/A" : fmtRelease(release.consensus, release.unit)}
              </td>
            </tr>
            <tr>
              <td className="tl">Actual</td>
              <td
                className={cn(
                  "tl tabular-nums font-semibold",
                  release?.actual != null && signClass(release.actual),
                )}
              >
                {release
                  ? fmtRelease(release.actual, release.unit)
                  : (event.actual ?? (released ? "N/A" : "—"))}
              </td>
            </tr>
            <tr>
              <td className="tl">Surprise</td>
              <td className="tl tabular-nums text-[var(--ink-3)]">
                {release?.surprise == null ? "N/A" : fmtPctPoints(release.surprise)}
              </td>
            </tr>
            <tr>
              <td className="tl">What happened?</td>
              <td className="tl text-[10.5px]">
                {(() => {
                  // Deterministic. Against consensus when there is one, and
                  // against the previous print when there is not — the two are
                  // different claims, so the wording says which was used.
                  if (!release || release.actual == null) return "N/A";
                  if (release.consensus != null) {
                    const d = release.actual - release.consensus;
                    return `${fmtRelease(release.actual, release.unit)} vs ${fmtRelease(release.consensus, release.unit)} expected — ${Math.abs(d) < 1e-9 ? "in line" : d > 0 ? "above consensus" : "below consensus"}.`;
                  }
                  if (release.previous == null) return "No prior print to compare against.";
                  const d = release.actual - release.previous;
                  return `${fmtRelease(release.actual, release.unit)} against ${fmtRelease(release.previous, release.unit)} previously — ${Math.abs(d) < 1e-9 ? "unchanged" : d > 0 ? "higher" : "lower"}. No consensus source is configured, so this compares to the prior print, not to expectations.`;
                })()}
              </td>
            </tr>
            <tr>
              <td className="tl">Relevant markets</td>
              <td className="tl text-[10.5px]">{tpl.relevantMarkets.join(", ")}</td>
            </tr>
          </tbody>
        </table>
        <div className="border-t border-[var(--line)] px-3 py-2 text-[10px] leading-snug text-[var(--ink-3)]">
          {releaseNote} {tpl.expectationNote}
        </div>
      </Panel>

      {/* ------------------------------------------ market-implied pricing */}
      <Panel
        title="Polymarket Implied Probability"
        subtitle="prediction-market pricing, not an objective probability"
        bodyClassName="p-0"
      >
        {!implied.available || !implied.market ? (
          <div className="px-3 py-3 text-[10.5px] leading-snug text-[var(--ink-3)]">
            <Chip tone="neutral">N/A</Chip> <span className="ml-1">{implied.note}</span>
          </div>
        ) : (
          <>
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Outcome</th>
                  <th>Implied</th>
                  <th>24H</th>
                  <th>7D</th>
                </tr>
              </thead>
              <tbody>
                {implied.market.outcomes.map((o) => (
                  <tr key={o.label}>
                    <td className="tl">{o.label}</td>
                    <td className="tabular-nums font-semibold">
                      {(o.probability * 100).toFixed(1)}%
                    </td>
                    <td className={cn("tabular-nums", signClass(o.change24h))}>
                      {o.change24h === null ? "N/A" : fmtPctPoints(o.change24h * 100)}
                    </td>
                    <td className={cn("tabular-nums", signClass(o.change7d))}>
                      {o.change7d === null ? "N/A" : fmtPctPoints(o.change7d * 100)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-[var(--line)] px-3 py-2 text-[9.5px] leading-snug text-[var(--ink-3)]">
              Volume {implied.market.volume?.toLocaleString() ?? "N/A"} · liquidity{" "}
              {implied.market.liquidity?.toLocaleString() ?? "N/A"} · updated{" "}
              {implied.market.updatedAt.slice(0, 16).replace("T", " ")}. This is what traders are
              paying, which reflects positioning and risk appetite as much as expectation.
            </div>
          </>
        )}
      </Panel>

      {/* ------------------------------------------------------- scenarios */}
      {tpl.scenarios.map((s) => {
        const exp = exposureFor(s.reactions);
        return (
          <Panel
            key={s.id}
            title={s.name}
            subtitle={s.trigger}
            actions={
              rows.length > 0 ? (
                <span className="text-[10px] text-[var(--ink-3)]">
                  {(exp.positive * 100).toFixed(0)}% positive ·{" "}
                  {(exp.negative * 100).toFixed(0)}% negative sensitivity
                </span>
              ) : null
            }
            bodyClassName="p-0"
          >
            <div className="border-b border-[var(--line)] px-3 py-2 text-[10.5px] leading-snug">
              <span className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                Why this matters —{" "}
              </span>
              {s.whyItMatters}
            </div>
            <div className="flex flex-wrap gap-1 border-b border-[var(--line)] px-3 py-2">
              {Object.entries(s.reactions).map(([asset, dir]) => (
                <span
                  key={asset}
                  title={`${asset}: ${DIRECTION_LABEL[dir]}`}
                  className={cn(
                    "rounded-sm border border-[var(--line)] px-1.5 py-0.5 text-[10px]",
                    CELL[dir],
                  )}
                >
                  {asset} {dir}
                </span>
              ))}
            </div>
            <div className="px-3 py-2">
              <div className="text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                Second-order effects
              </div>
              <ul className="mt-1 space-y-1">
                {s.secondOrder.map((x) => (
                  <li key={x} className="text-[10.5px] leading-snug text-[var(--ink-2)]">
                    · {x}
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
        );
      })}

      {/* -------------------------------------------------- scenario matrix */}
      <Panel
        title="Event × Position Matrix"
        subtitle="hover a cell for the sensitivity it encodes"
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Position</th>
                {tpl.scenarios.map((s) => (
                  <th key={s.id} className="tl">
                    {s.name.split(" — ")[0]}
                  </th>
                ))}
                <th>Weight</th>
              </tr>
            </thead>
            <tbody>
              {matrixCodes.map((code) => {
                const row = rows.find((r) => r.position.code.toUpperCase() === code);
                return (
                  <tr key={code}>
                    <td className="tl font-semibold">
                      <Link
                        href={`/ticker/${encodeURIComponent(code)}`}
                        className="hover:text-[var(--amber)]"
                      >
                        {code}
                      </Link>
                    </td>
                    {tpl.scenarios.map((s) => {
                      const d = s.reactions[code] ?? "0";
                      return (
                        <td
                          key={s.id}
                          className={cn("tl tabular-nums", CELL[d])}
                          title={`${s.name}: ${DIRECTION_LABEL[d]}`}
                        >
                          {d}
                        </td>
                      );
                    })}
                    <td className="tabular-nums text-[var(--ink-3)]">
                      {row ? `${(row.currentWeight * 100).toFixed(1)}%` : "not held"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ------------------------------------------------------- timeline */}
      <Panel
        title="Reaction Timeline"
        subtitle="the immediate move and the medium-term direction frequently differ"
        bodyClassName="p-0"
      >
        <table className="grid-table">
          <tbody>
            {tpl.timeline.map((t) => (
              <tr key={t.horizon}>
                <td className="tl w-[140px] font-semibold">{t.horizon}</td>
                <td className="tl text-[10.5px]">{t.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* -------------------------------------------------- event study */}
      <Panel
        title="Historical Event Study"
        subtitle={
          study.total > 0
            ? `median reaction across the last ${study.total} occurrences · real prices`
            : "not enough real price history for this event type"
        }
        bodyClassName="p-0"
      >
        {study.total === 0 ? (
          <Empty>
            No past occurrence of this event falls inside the available price history.
          </Empty>
        ) : (
          <>
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Asset</th>
                  <th>Median 1D</th>
                  <th>Median 1W</th>
                  <th>Median 1M</th>
                  <th className="tl">Positive at 1M</th>
                </tr>
              </thead>
              <tbody>
                {STUDY_ASSETS.filter((k) => series[k]?.length).map((k) => {
                  const m = study.median[k];
                  return (
                    <tr key={k}>
                      <td className="tl font-semibold">{k}</td>
                      <td className={cn("tabular-nums", signClass(m?.d1))}>
                        {m?.d1 === null || m?.d1 === undefined ? "N/A" : fmtPctPoints(m.d1)}
                      </td>
                      <td className={cn("tabular-nums", signClass(m?.w1))}>
                        {m?.w1 === null || m?.w1 === undefined ? "N/A" : fmtPctPoints(m.w1)}
                      </td>
                      <td className={cn("tabular-nums", signClass(m?.m1))}>
                        {m?.m1 === null || m?.m1 === undefined ? "N/A" : fmtPctPoints(m.m1)}
                      </td>
                      <td className="tl text-[10px] text-[var(--ink-3)]">
                        {study.positive[k] ?? 0} / {study.total}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="border-t border-[var(--line)] px-3 py-2 text-[9.5px] leading-snug text-[var(--ink-3)]">
              Measured from real closes around each past occurrence. These are what the market
              did, not why — the sample mixes policy regimes, and a median across materially
              different regimes should not be read as one conclusion. Horizons running past the
              end of the series read N/A rather than being clipped.
            </div>
          </>
        )}
      </Panel>

      {/* ------------------------------------------------- analogue cohorts */}
      {cohorts.length > 0 && (
        <Panel
          title="Historical Analogues"
          subtitle="the same measurement, restricted to genuinely comparable occasions"
          bodyClassName="p-0"
        >
          {cohorts.map(({ cohort, study: cs }) => (
            <div key={cohort.id} className="border-b border-[var(--line)] last:border-b-0">
              <div className="flex flex-wrap items-baseline gap-2 px-3 py-1.5">
                <span className="text-[11px] font-semibold">{cohort.label}</span>
                <Chip tone="neutral">n = {cs.total}</Chip>
                <span className="min-w-0 flex-1 text-[9.5px] leading-snug text-[var(--ink-3)]">
                  {cohort.rationale}
                </span>
              </div>
              {cs.total === 0 ? (
                <div className="px-3 pb-2 text-[10px] text-[var(--ink-3)]">
                  No occasion in this cohort falls inside the available price history.
                </div>
              ) : (
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th className="tl">Asset</th>
                      <th>Median 1D</th>
                      <th>Median 1W</th>
                      <th>Median 1M</th>
                      <th className="tl">Positive at 1M</th>
                    </tr>
                  </thead>
                  <tbody>
                    {STUDY_ASSETS.filter((k) => series[k]?.length).map((k) => {
                      const m = cs.median[k];
                      return (
                        <tr key={k}>
                          <td className="tl font-semibold">{k}</td>
                          <td className={cn("tabular-nums", signClass(m?.d1))}>
                            {m?.d1 == null ? "N/A" : fmtPctPoints(m.d1)}
                          </td>
                          <td className={cn("tabular-nums", signClass(m?.w1))}>
                            {m?.w1 == null ? "N/A" : fmtPctPoints(m.w1)}
                          </td>
                          <td className={cn("tabular-nums", signClass(m?.m1))}>
                            {m?.m1 == null ? "N/A" : fmtPctPoints(m.m1)}
                          </td>
                          <td className="tl text-[10px] text-[var(--ink-3)]">
                            {cs.positive[k] ?? 0} / {cs.total}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          ))}
          <div className="border-t border-[var(--line)] px-3 py-2 text-[9.5px] leading-snug text-[var(--ink-3)]">
            Cohort membership is curated and stated above, so you can disagree with it. Sample
            counts are small by construction — that is the price of comparability, and a median
            over five observations is an anecdote with arithmetic, not evidence of causality.
          </div>
        </Panel>
      )}
    </div>
  );
}
