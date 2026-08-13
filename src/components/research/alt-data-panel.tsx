import { Chip } from "@/components/shell/ui";
import { compactUsd } from "./primitives";
import { ConfidenceBadge } from "./confidence-badge";
import { PANEL_CONFIDENCE } from "@/lib/research/confidence";
import type { GovContract, HiringActivity, Nowcast } from "@/lib/research/alt-data";

/**
 * Federal awards and the alternative-data nowcast.
 *
 * The obligation and the ceiling are separate columns on purpose: an award
 * headline usually quotes the ceiling, which is the maximum the vehicle could
 * ever be worth rather than money the government has committed. Only the
 * obligation is real spending, and only that is filled in here.
 */
export function AltDataPanel({
  contracts,
  hiring,
  nowcast,
  revenueTtm,
}: {
  contracts: GovContract[];
  hiring: HiringActivity | null;
  nowcast: Nowcast;
  revenueTtm: number | null;
}) {
  const obligated12m = contracts
    .filter((c) => Date.parse(c.awardDate) > Date.now() - 365 * 86_400_000)
    .reduce((s, c) => s + (c.obligatedAmount ?? 0), 0);
  const vsRevenue =
    revenueTtm && revenueTtm > 0 && obligated12m > 0 ? (obligated12m / revenueTtm) * 100 : null;
  const latest = contracts.map((c) => c.awardDate).sort().at(-1) ?? null;

  return (
    <div>
      {/* ------------------------------------------------- nowcast */}
      <div className="flex flex-wrap items-baseline gap-2 border-b border-[var(--line)] px-3 py-2">
        <span className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
          Business Activity Nowcast
        </span>
        <Chip
          tone={
            nowcast.verdict === "ACCELERATING"
              ? "pos"
              : nowcast.verdict === "DECELERATING"
                ? "neg"
                : "neutral"
          }
        >
          {nowcast.verdict}
        </Chip>
        <span className="text-[9.5px] text-[var(--ink-3)]">
          coverage {nowcast.coverage}/{nowcast.total}
        </span>
        <Chip tone="warn">EXPERIMENTAL ALTERNATIVE-DATA SIGNAL</Chip>
      </div>

      <div className="grid grid-cols-1 divide-y divide-[var(--line)] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="px-3 py-2">
          <div className="mb-0.5 text-[9.5px] uppercase tracking-wide text-emerald-400">Why?</div>
          {nowcast.supporting.length === 0 ? (
            <p className="text-[10px] text-[var(--ink-3)]">Nothing supporting on file.</p>
          ) : (
            <ul className="list-disc space-y-0.5 pl-4">
              {nowcast.supporting.map((x, i) => (
                <li key={i} className="text-[10.5px] leading-snug">{x}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-3 py-2">
          <div className="mb-0.5 text-[9.5px] uppercase tracking-wide text-amber-400">
            What argues against it?
          </div>
          {nowcast.against.length === 0 ? (
            <p className="text-[10px] text-[var(--ink-3)]">Nothing contradicting on file.</p>
          ) : (
            <ul className="list-disc space-y-0.5 pl-4">
              {nowcast.against.map((x, i) => (
                <li key={i} className="text-[10.5px] leading-snug">{x}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="border-y border-[var(--line)] px-3 py-1.5 text-[9.5px] leading-snug text-[var(--ink-3)]">
        {nowcast.note}
      </div>

      {/* ------------------------------------------------- hiring */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <span className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
          Job Postings
        </span>
        {hiring ? (
          <>
            <Chip
              tone={
                hiring.trend === "ACCELERATING" ? "pos" : hiring.trend === "DECELERATING" ? "neg" : "neutral"
              }
            >
              {hiring.trend === "ACCELERATING"
                ? "HIRING ACCELERATING"
                : hiring.trend === "DECELERATING"
                  ? "HIRING SLOWING"
                  : hiring.trend === "STABLE"
                    ? "STABLE"
                    : "N/A"}
            </Chip>
            <span className="text-[10px] text-[var(--ink-2)]">
              {hiring.totalOpenings} open roles
            </span>
            <span className="text-[9.5px] text-[var(--ink-3)]">
              30D{" "}
              {hiring.change30d === null
                ? "N/A"
                : `${hiring.change30d > 0 ? "+" : ""}${hiring.change30d.toFixed(0)}%`}{" "}
              · 90D{" "}
              {hiring.change90d === null
                ? "N/A"
                : `${hiring.change90d > 0 ? "+" : ""}${hiring.change90d.toFixed(0)}%`}
            </span>
          </>
        ) : (
          <span className="text-[10px] text-[var(--ink-3)]">
            N/A — this company does not publish a structured job board this app can read.
          </span>
        )}
      </div>

      {hiring && hiring.byCategory.length > 0 && (
        <>
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Function</th>
                <th>Open roles</th>
                <th>90D change</th>
              </tr>
            </thead>
            <tbody>
              {hiring.byCategory.map((c) => (
                <tr key={c.label}>
                  <td className="tl">{c.label}</td>
                  <td className="tabular-nums">{c.count}</td>
                  <td className="tabular-nums text-[var(--ink-3)]">
                    {c.change90d === null
                      ? "N/A"
                      : `${c.change90d > 0 ? "+" : ""}${c.change90d.toFixed(0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-b border-[var(--line)] px-3 py-1.5 text-[9.5px] leading-snug text-[var(--ink-3)]">
            Counts are live from the company&apos;s own Greenhouse board. Change columns compare
            against stored daily snapshots and read N/A until this app has been collecting for
            the window. Hiring is a spending decision, not revenue — it says where a company is
            putting people, nothing more.
          </div>
        </>
      )}

      {/* ------------------------------------------------- contracts */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
          Federal Contract Awards
        </span>
        {contracts.length > 0 && (
          <ConfidenceBadge report={PANEL_CONFIDENCE.contracts(latest)} source="USAspending.gov" />
        )}
      </div>

      {contracts.length === 0 ? (
        <p className="px-3 pb-3 text-[10.5px] leading-snug text-[var(--ink-3)]">
          N/A — no federal awards on file for this company in the last two years, or the company
          is not in the recipient map. USAspending indexes legal entities rather than tickers, so
          only explicitly mapped issuers are queried; approximate name matching would attach
          awards belonging to unrelated companies.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-t border-[var(--line)] sm:grid-cols-3">
            <div className="px-3 py-1.5">
              <div className="text-[9.5px] text-[var(--ink-3)]">Obligated, 12M</div>
              <div className="tabular-nums text-[12px]">{compactUsd(obligated12m)}</div>
            </div>
            <div className="px-3 py-1.5">
              <div className="text-[9.5px] text-[var(--ink-3)]">Awards on file</div>
              <div className="tabular-nums text-[12px]">{contracts.length}</div>
            </div>
            <div className="px-3 py-1.5" title="Obligated federal dollars against trailing revenue. A scale check, not a revenue forecast.">
              <div className="text-[9.5px] text-[var(--ink-3)]">vs TTM revenue</div>
              <div className="tabular-nums text-[12px]">
                {vsRevenue === null ? "N/A" : `${vsRevenue.toFixed(2)}%`}
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Award Date</th>
                  <th className="tl">Agency</th>
                  <th>Obligated</th>
                  <th>Ceiling</th>
                  <th className="tl">Type</th>
                  <th className="tl">Description</th>
                </tr>
              </thead>
              <tbody>
                {contracts.slice(0, 12).map((c, i) => (
                  <tr key={i}>
                    <td className="tl tabular-nums">{c.awardDate || "N/A"}</td>
                    <td className="tl max-w-[180px] truncate" title={c.agency}>{c.agency}</td>
                    <td className="tabular-nums font-medium">{compactUsd(c.obligatedAmount)}</td>
                    <td
                      className="tabular-nums text-[var(--ink-3)]"
                      title="Contract ceiling is not carried by this endpoint. It is never inferred from the obligation."
                    >
                      {compactUsd(c.potentialAwardAmount)}
                    </td>
                    <td className="tl text-[10px] text-[var(--ink-3)]">{c.type}</td>
                    <td className="tl max-w-[280px] truncate text-[10px] text-[var(--ink-3)]" title={c.program}>
                      {c.program}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] leading-snug text-[var(--ink-3)]">
            <strong>Obligated</strong> is money the government has committed.{" "}
            <strong>Ceiling</strong> is the maximum the vehicle could ever be worth and is not
            carried by this endpoint — it reads N/A rather than being inferred. Neither is
            guaranteed revenue.
          </div>
        </>
      )}
    </div>
  );
}
