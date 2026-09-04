import { Chip, Panel } from "@/components/shell/ui";
import type { EgBundle } from "@/lib/engines/eg-bundle";

/**
 * VALUATION TAB — model desk theme: fair-value fan, per-model table with
 * weights and notes, rejected models with reasons, and the expectation gap.
 * INVALID verdicts render the reason, never a fabricated number.
 */

const money = (v: number | null, d = 2) => (v === null ? "N/A" : `$${v.toFixed(d)}`);
const pts = (v: number | null, d = 1) => (v === null ? "N/A" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);

function Fan({ eg }: { eg: EgBundle }) {
  const v = eg.valuation;
  if (v.verdict !== "OK" || v.bear === null || v.base === null || v.bull === null) return null;
  const lo = Math.min(v.bear, eg.price) * 0.97;
  const hi = Math.max(v.bull, eg.price) * 1.03;
  const X = (p: number) => ((p - lo) / (hi - lo)) * 100;
  return (
    <div className="px-3 pb-3 pt-1">
      <div className="relative h-9">
        <div className="absolute inset-x-0 top-4 h-1 rounded bg-[var(--line)]" />
        <div
          className="absolute top-4 h-1 rounded bg-amber-500/60"
          style={{ left: `${X(v.bear)}%`, width: `${X(v.bull) - X(v.bear)}%` }}
        />
        {[
          { p: v.bear, l: `Bear ${money(v.bear)}`, c: "text-rose-400" },
          { p: v.base, l: `Base ${money(v.base)}`, c: "text-amber-400" },
          { p: v.bull, l: `Bull ${money(v.bull)}`, c: "text-emerald-400" },
        ].map((m) => (
          <div key={m.l} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: `${X(m.p)}%` }}>
            <div className={`text-[9px] ${m.c}`}>{m.l}</div>
            <div className="mx-auto mt-0.5 h-3.5 w-px bg-current opacity-60" />
          </div>
        ))}
        <div className="absolute top-5 -translate-x-1/2" style={{ left: `${X(eg.price)}%` }}>
          <div className="mx-auto h-3.5 w-0.5 bg-white" />
          <div className="text-[9px] text-white">Price {money(eg.price)}</div>
        </div>
      </div>
    </div>
  );
}

export function ValuationTab({ eg }: { eg: EgBundle }) {
  const v = eg.valuation;
  const d = eg.decision;
  const ex = eg.expectations;
  return (
    <div className="flex flex-col gap-3" style={{ ["--tab-accent" as string]: "#f59e0b" }}>
      <Panel
        title="EG Fair Value"
        subtitle="five deterministic models, blended by confidence weight — assumptions stated, nothing invented"
        actions={
          <Chip tone={d.view === "ATTRACTIVE" ? "pos" : d.view === "EXPENSIVE" || d.view === "HIGH_RISK" ? "neg" : "neutral"}>
            {d.view.replaceAll("_", " ")}
          </Chip>
        }
        bodyClassName="p-0"
      >
        {v.verdict === "INVALID" ? (
          <div className="p-4 text-[11.5px]">
            <Chip tone="warn">VALUATION INVALID</Chip>
            <p className="mt-2 max-w-[80ch] leading-snug text-[var(--ink-2)]">
              {v.invalidReason ?? "Inputs failed the data-quality gates."} EG publishes N/A rather than a
              number built on inconsistent inputs.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-4">
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">Fair value (base)</div>
                <div className="text-[14px] font-semibold tabular-nums">{money(v.base)}</div>
                <div className="text-[9.5px] text-[var(--ink-3)]">{money(v.bear)} – {money(v.bull)}</div>
              </div>
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">Upside to base</div>
                <div className={`text-[14px] font-semibold tabular-nums ${(v.upsidePct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {pts(v.upsidePct)}
                </div>
                <div className="text-[9.5px] text-[var(--ink-3)]">confidence {v.confidence}</div>
              </div>
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">Street target</div>
                <div className="text-[14px] font-semibold tabular-nums">{money(ex.consensus.target)}</div>
                <div className="text-[9.5px] text-[var(--ink-3)]">{d.consensusLabel ?? "N/A"}</div>
              </div>
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">Expectation gap</div>
                <div className="text-[14px] font-semibold tabular-nums">{pts(ex.expectationGapPct)}</div>
                <div className="text-[9.5px] text-[var(--ink-3)]">
                  revision {ex.revisionScore ?? "N/A"}/100 · {ex.gapReading ?? "N/A"}
                </div>
              </div>
            </div>
            <Fan eg={eg} />
          </>
        )}
      </Panel>

      {v.models.length > 0 && (
        <Panel title="Models" subtitle="each model's answer, its weight in the blend, and its basis" bodyClassName="p-0">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Model</th>
                <th>Fair value</th>
                <th>vs price</th>
                <th>Weight</th>
                <th className="tl">Basis</th>
              </tr>
            </thead>
            <tbody>
              {v.models.map((m) => (
                <tr key={m.model}>
                  <td className="tl font-semibold">{m.model.replaceAll("_", " ")}</td>
                  <td className="tabular-nums">{money(m.fairValue)}</td>
                  <td className={`tabular-nums ${m.fairValue >= eg.price ? "text-emerald-400" : "text-rose-400"}`}>
                    {pts(eg.price > 0 ? (m.fairValue / eg.price - 1) * 100 : null)}
                  </td>
                  <td className="tabular-nums">{(m.weight * 100).toFixed(0)}%</td>
                  <td className="tl text-[10px] text-[var(--ink-3)]">{m.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {v.rejectedModels.length > 0 && (
            <div className="border-t border-[var(--line)] px-3 py-1.5 text-[10px] text-[var(--ink-3)]">
              Rejected: {v.rejectedModels.map((r) => `${r.model.replaceAll("_", " ")} (${r.reason})`).join(" · ")}
            </div>
          )}
        </Panel>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Why" bodyClassName="p-3">
          {v.reasons.length || d.reasons.length ? (
            <ul className="list-disc pl-4 text-[11.5px] leading-snug">
              {(d.reasons.length ? d.reasons : v.reasons).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : (
            <div className="text-[11px] text-[var(--ink-3)]">N/A</div>
          )}
        </Panel>
        <Panel title="Risks" bodyClassName="p-3">
          {(d.risks.length ? d.risks : v.risks).length ? (
            <ul className="list-disc pl-4 text-[11.5px] leading-snug">
              {(d.risks.length ? d.risks : v.risks).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : (
            <div className="text-[11px] text-[var(--ink-3)]">N/A</div>
          )}
        </Panel>
      </div>

      {Object.keys(v.assumptions).length > 0 && (
        <Panel title="Assumptions" subtitle="the numbers the models actually used" bodyClassName="p-0">
          <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] text-[11px] sm:grid-cols-4">
            {Object.entries(v.assumptions).map(([k, val]) => (
              <div key={k} className="px-3 py-1.5">
                <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">{k}</div>
                <div className="tabular-nums">
                  {val === null ? "N/A" : typeof val === "number" ? val.toFixed(Math.abs(val) > 100 ? 0 : 2) : val}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
