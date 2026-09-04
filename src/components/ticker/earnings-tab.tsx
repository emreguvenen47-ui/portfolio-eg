import { Chip, Panel } from "@/components/shell/ui";
import type { EgBundle } from "@/lib/engines/eg-bundle";

/**
 * EARNINGS TAB — event desk theme: next report, expectations into the print,
 * surprise history, and the forward estimate ladder. All EODHD, no guesses.
 */

const money = (v: number | null, d = 2) => (v === null ? "N/A" : `$${v.toFixed(d)}`);

export function EarningsTab({ eg }: { eg: EgBundle }) {
  const s = eg.snapshot;
  const ex = eg.expectations;
  const hist = s.earningsHistory;
  const beats = hist.filter((h) => h.epsActual !== null && h.epsEstimate !== null && h.epsActual > h.epsEstimate).length;
  const graded = hist.filter((h) => h.epsActual !== null && h.epsEstimate !== null).length;

  const today = new Date().toISOString().slice(0, 10);
  const nextEst = s.forwardEstimates.find((e) => e.periodEnd > today) ?? null;

  return (
    <div className="flex flex-col gap-3" style={{ ["--tab-accent" as string]: "#fb923c" }}>
      {/* Next event */}
      <Panel title="Next Report" subtitle="what the street expects going in" bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-4">
          <div className="px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">Period ending</div>
            <div className="text-[13px] font-semibold tabular-nums">{nextEst?.periodEnd ?? "N/A"}</div>
          </div>
          <div className="px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">Street EPS</div>
            <div className="text-[13px] font-semibold tabular-nums">{money(nextEst?.epsAvg ?? null)}</div>
            <div className="text-[9.5px] text-[var(--ink-3)]">
              {nextEst?.epsLow != null && nextEst?.epsHigh != null ? `${money(nextEst.epsLow)} – ${money(nextEst.epsHigh)}` : ""}
            </div>
          </div>
          <div className="px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">Street revenue</div>
            <div className="text-[13px] font-semibold tabular-nums">
              {nextEst?.revenueAvg != null ? `$${(nextEst.revenueAvg / 1e9).toFixed(2)}B` : "N/A"}
            </div>
            <div className="text-[9.5px] text-[var(--ink-3)]">
              {nextEst?.analystCount != null ? `${nextEst.analystCount} analysts` : ""}
            </div>
          </div>
          <div className="px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">Beat rate</div>
            <div className="text-[13px] font-semibold tabular-nums">
              {graded ? `${beats}/${graded}` : "N/A"}
            </div>
            <div className="text-[9.5px] text-[var(--ink-3)]">last {graded} graded quarters</div>
          </div>
        </div>
      </Panel>

      {/* Surprise history */}
      <Panel title="Surprise History" subtitle="reported EPS vs consensus · EODHD earnings history" bodyClassName="p-0">
        {hist.length === 0 ? (
          <div className="p-3 text-[11px] text-[var(--ink-3)]">No graded earnings history available.</div>
        ) : (
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Period</th>
                <th className="tl">Reported</th>
                <th>EPS actual</th>
                <th>EPS est.</th>
                <th>Surprise</th>
                <th className="tl">Result</th>
              </tr>
            </thead>
            <tbody>
              {hist.map((h) => {
                const beat =
                  h.epsActual !== null && h.epsEstimate !== null ? h.epsActual >= h.epsEstimate : null;
                return (
                  <tr key={h.periodEnd}>
                    <td className="tl tabular-nums">{h.periodEnd}</td>
                    <td className="tl tabular-nums text-[var(--ink-3)]">{h.reportDate || "—"}</td>
                    <td className="tabular-nums">{money(h.epsActual)}</td>
                    <td className="tabular-nums">{money(h.epsEstimate)}</td>
                    <td className={`tabular-nums ${(h.surprisePct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {h.surprisePct === null ? "N/A" : `${h.surprisePct > 0 ? "+" : ""}${h.surprisePct.toFixed(1)}%`}
                    </td>
                    <td className="tl">
                      {beat === null ? (
                        <Chip tone="neutral">N/A</Chip>
                      ) : beat ? (
                        <Chip tone="pos">BEAT</Chip>
                      ) : (
                        <Chip tone="neg">MISS</Chip>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      {/* Forward ladder */}
      <Panel title="Forward Estimate Ladder" subtitle="street EPS and revenue by period · Earnings.Trend" bodyClassName="p-0">
        {s.forwardEstimates.length === 0 ? (
          <div className="p-3 text-[11px] text-[var(--ink-3)]">No forward estimates published for this name.</div>
        ) : (
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Period end</th>
                <th>EPS avg</th>
                <th>EPS low</th>
                <th>EPS high</th>
                <th>Revenue avg</th>
                <th>Analysts</th>
              </tr>
            </thead>
            <tbody>
              {s.forwardEstimates.map((e) => (
                <tr key={e.periodEnd}>
                  <td className="tl tabular-nums">{e.periodEnd}</td>
                  <td className="tabular-nums">{money(e.epsAvg)}</td>
                  <td className="tabular-nums text-[var(--ink-3)]">{money(e.epsLow)}</td>
                  <td className="tabular-nums text-[var(--ink-3)]">{money(e.epsHigh)}</td>
                  <td className="tabular-nums">{e.revenueAvg !== null ? `$${(e.revenueAvg / 1e9).toFixed(2)}B` : "N/A"}</td>
                  <td className="tabular-nums text-[var(--ink-3)]">{e.analystCount ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {/* Expectations engine */}
      <Panel title="Expectations Into the Print" subtitle="revision score and what the price already assumes" bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-4">
          <div className="px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">Revision score</div>
            <div className="text-[13px] font-semibold tabular-nums">{ex.revisionScore ?? "N/A"}/100</div>
          </div>
          <div className="px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">Street fwd EPS</div>
            <div className="text-[13px] font-semibold tabular-nums">{money(ex.streetForwardEps)}</div>
          </div>
          <div className="px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">Price-implied EPS</div>
            <div className="text-[13px] font-semibold tabular-nums">{money(ex.valuationImpliedEps)}</div>
          </div>
          <div className="px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">Gap</div>
            <div className="text-[13px] font-semibold tabular-nums">
              {ex.expectationGapPct === null ? "N/A" : `${ex.expectationGapPct > 0 ? "+" : ""}${ex.expectationGapPct.toFixed(1)}%`}
            </div>
            <div className="text-[9.5px] text-[var(--ink-3)]">{ex.gapReading ?? ""}</div>
          </div>
        </div>
        {ex.revisionParts.length > 0 && (
          <div className="border-t border-[var(--line)] px-3 py-1.5 text-[10px] text-[var(--ink-3)]">
            {ex.revisionParts.join(" · ")}
          </div>
        )}
      </Panel>
    </div>
  );
}
