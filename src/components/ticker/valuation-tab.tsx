import { Chip, Panel } from "@/components/shell/ui";
import { SECTOR_PE } from "@/lib/engines/valuation";
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

      {/* ------------------------------------------------ full model math */}
      {v.models.length > 0 && (
        <Panel title="Blend Decomposition" subtitle="how each model's answer moves the blended fair value — nothing hidden" bodyClassName="p-0">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Model</th>
                <th>Fair value</th>
                <th>Weight</th>
                <th>Normalized</th>
                <th>Contribution</th>
                <th className="tl">Exact inputs</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const wsum = v.models.reduce((x, m) => x + m.weight, 0);
                const a = v.assumptions;
                const inputsFor = (model: string): string => {
                  switch (model) {
                    case "FWD_PE":
                      return `fwd EPS $${a.fwdEps ?? "?"} × blended multiple ${a.fwdMultiple ?? "?"}× (60% own fwd P/E + 40% sector anchor ${SECTOR_PE[eg.snapshot.identity.companyType]}×, clamped 5–45)`;
                    case "FCF_YIELD":
                      return `FCF/share $${a.fcfPerShare ?? "?"} ÷ required yield ${typeof a.requiredFcfYield === "number" ? (a.requiredFcfYield * 100).toFixed(1) : "?"}%`;
                    case "EV_EBITDA":
                      return `${a.evEbitdaMultiple ?? "?"}× TTM EBITDA ${eg.snapshot.ebitdaTtm !== null ? "$" + (eg.snapshot.ebitdaTtm / 1e9).toFixed(1) + "B" : "?"} − net debt ${eg.snapshot.netDebt !== null ? "$" + (eg.snapshot.netDebt / 1e9).toFixed(1) + "B" : "?"} ÷ ${eg.snapshot.sharesOutstanding !== null ? (eg.snapshot.sharesOutstanding / 1e9).toFixed(2) + "B shares" : "?"}`;
                    case "P_B_JUSTIFIED":
                      return `justified P/B ${a.justifiedPb ?? "?"}× (ROE ${eg.snapshot.roe !== null ? (eg.snapshot.roe * 100).toFixed(0) : "?"}% ÷ 10% cost of equity, clamped 0.6–2.5) × book/share $${eg.snapshot.bookValuePerShare?.toFixed(2) ?? "?"}`;
                    case "STREET_TARGET":
                      return `consensus target $${a.streetTarget ?? "?"} (sanity-screened 0.45–2.2× price)`;
                    default:
                      return "";
                  }
                };
                return v.models.map((m) => (
                  <tr key={m.model}>
                    <td className="tl font-semibold">{m.model.replaceAll("_", " ")}</td>
                    <td className="tabular-nums">{money(m.fairValue)}</td>
                    <td className="tabular-nums">{m.weight.toFixed(2)}</td>
                    <td className="tabular-nums">{((m.weight / wsum) * 100).toFixed(0)}%</td>
                    <td className="tabular-nums font-medium">{money(m.fairValue * (m.weight / wsum))}</td>
                    <td className="tl max-w-[380px] text-[10px] leading-snug text-[var(--ink-3)]">{inputsFor(m.model)}</td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
          <div className="border-t border-[var(--line)] px-3 py-1.5 text-[10px] text-[var(--ink-3)]">
            Σ contributions = base fair value {money(v.base)}. Scenario band: bear/bull scale the base by the street
            estimate dispersion ({String(v.assumptions.estimateDispersion ?? "±15% default when no dispersion data")}).
          </div>
        </Panel>
      )}

      {/* -------------------------------------------------- sensitivity grid */}
      {(() => {
        const a = v.assumptions;
        const epsAvg = typeof a.fwdEps === "number" ? a.fwdEps : null;
        const mult = typeof a.fwdMultiple === "number" ? a.fwdMultiple : null;
        if (epsAvg === null || mult === null || v.verdict !== "OK") return null;
        const nextEst = eg.snapshot.forwardEstimates.find((e) => e.epsAvg !== null);
        const epsLow = nextEst?.epsLow ?? epsAvg * 0.9;
        const epsHigh = nextEst?.epsHigh ?? epsAvg * 1.1;
        const epsRow = [epsLow, epsAvg, epsHigh];
        const mults = [mult * 0.8, mult * 0.9, mult, mult * 1.1, mult * 1.2];
        return (
          <Panel
            title="Sensitivity — Fair Value vs Forward EPS × Multiple"
            subtitle="green = above the current price, red = below; the center cell is the model's own base case"
            bodyClassName="p-0"
          >
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">EPS \ Multiple</th>
                  {mults.map((m) => (
                    <th key={m} className="tabular-nums">{m.toFixed(1)}×</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {epsRow.map((e, ri) => (
                  <tr key={e}>
                    <td className="tl tabular-nums">
                      ${e.toFixed(2)}
                      <span className="ml-1 text-[9px] text-[var(--ink-3)]">{ri === 0 ? "street low" : ri === 1 ? "street avg" : "street high"}</span>
                    </td>
                    {mults.map((m, ci) => {
                      const fv = e * m;
                      const up = eg.price > 0 ? (fv / eg.price - 1) * 100 : 0;
                      const isBase = ri === 1 && ci === 2;
                      return (
                        <td
                          key={m}
                          className={`tabular-nums ${isBase ? "font-bold underline" : ""} ${up >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                          title={`fair ${fv.toFixed(2)} → ${up >= 0 ? "+" : ""}${up.toFixed(1)}% vs price`}
                        >
                          {fv.toFixed(0)}
                          <span className="ml-1 text-[9px] opacity-70">{up >= 0 ? "+" : ""}{up.toFixed(0)}%</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        );
      })()}

      {/* ------------------------------------------- multiples vs sector anchor */}
      <Panel title="Where the Multiples Sit" subtitle="company vs the sector anchor the models use — every input on the table" bodyClassName="p-0">
        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">Multiple</th>
              <th>Company</th>
              <th>Sector anchor</th>
              <th>vs anchor</th>
              <th className="tl">Basis</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const sn = eg.snapshot;
              const anchor = SECTOR_PE[sn.identity.companyType];
              const rows: Array<[string, number | null, number | null, string]> = [
                ["P/E (TTM)", sn.peTtm, anchor, "trailing reported EPS"],
                ["Forward P/E", sn.forwardPe, anchor, "street next-FY EPS"],
                ["PEG", sn.peg, null, "P/E ÷ expected growth"],
                ["P/S", sn.priceToSales, null, "live mcap ÷ TTM revenue (self-computed)"],
                ["P/B", sn.priceToBook, null, "live mcap ÷ MRQ equity (self-computed)"],
                ["EV/EBITDA", sn.evToEbitda, null, "live EV ÷ TTM EBITDA (self-computed)"],
                ["EV/Sales", sn.evToRevenue, null, "live EV ÷ TTM revenue (self-computed)"],
                ["FCF yield", sn.fcfYield !== null ? sn.fcfYield * 100 : null, null, "TTM FCF ÷ live mcap, %"],
              ];
              return rows.map(([label, val, anch, basis]) => (
                <tr key={label}>
                  <td className="tl">{label}</td>
                  <td className="tabular-nums font-medium">{val === null ? "N/A" : val.toFixed(label === "FCF yield" ? 2 : 1)}{label === "FCF yield" ? "%" : "×"}</td>
                  <td className="tabular-nums text-[var(--ink-3)]">{anch === null ? "—" : `${anch}×`}</td>
                  <td className={`tabular-nums ${val !== null && anch !== null ? (val <= anch ? "text-emerald-400" : "text-amber-400") : "text-[var(--ink-3)]"}`}>
                    {val !== null && anch !== null ? `${val <= anch ? "" : "+"}${(((val as number) / anch - 1) * 100).toFixed(0)}%` : "—"}
                  </td>
                  <td className="tl text-[10px] text-[var(--ink-3)]">{basis}</td>
                </tr>
              ));
            })()}
          </tbody>
        </table>
      </Panel>

      {/* -------------------------------------------------- analyst structure */}
      <Panel title="Analyst Structure" subtitle="who stands where — counts, target, dispersion" bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-5">
          {(() => {
            const c = eg.snapshot.analystCounts;
            const cells: Array<[string, number | null, string]> = [
              ["Strong buy", c.strongBuy, "text-emerald-400"],
              ["Buy", c.buy, "text-emerald-300"],
              ["Hold", c.hold, ""],
              ["Sell", c.sell, "text-rose-300"],
              ["Strong sell", c.strongSell, "text-rose-400"],
            ];
            return cells.map(([k, n, cls]) => (
              <div key={k} className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-wider text-[var(--ink-3)]">{k}</div>
                <div className={`text-[14px] font-semibold tabular-nums ${cls}`}>{n ?? "—"}</div>
              </div>
            ));
          })()}
        </div>
        <div className="border-t border-[var(--line)] px-3 py-1.5 text-[10px] text-[var(--ink-3)]">
          Rating {eg.snapshot.analystRating?.toFixed(1) ?? "N/A"}/5 · target {money(eg.snapshot.analystTargetPrice)} ·
          next-period estimates: {(() => { const e = eg.snapshot.forwardEstimates.find((x) => x.epsAvg !== null); return e ? `EPS $${e.epsLow ?? "?"} / $${e.epsAvg} / $${e.epsHigh ?? "?"} (${e.analystCount ?? "?"} analysts, period ${e.periodEnd})` : "N/A"; })()}
        </div>
      </Panel>

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
