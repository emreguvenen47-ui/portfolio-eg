import { getContext } from "@/lib/server/context";
import { Chip, Kpi, Note, Panel } from "@/components/shell/ui";
import { DEFAULT_ALERTS, type AlertRule } from "@/lib/portfolio/settings";
import { technicals } from "@/lib/portfolio/analytics";
import { cumulative, maxDrawdown, toReturns } from "@/lib/finance/stats";
import { fmtPct, fmtPctPoints } from "@/lib/format";
import { RuleBuilder } from "@/components/alerts/rule-builder";
import { evaluateAlerts } from "@/lib/portfolio/alert-engine";
import { listEvents, listRules, recordFires } from "@/lib/server/alert-store";

export const dynamic = "force-dynamic";

interface Evaluated {
  rule: AlertRule;
  triggered: boolean;
  actual: string;
  detail: string;
  unavailable?: boolean;
}

export default async function AlertsPage() {
  const ctx = await getContext({ markets: true });
  if (ctx.error) return <Panel title="Error"><Note tone="warn">{ctx.error}</Note></Panel>;

  const { rows, bundle, series, usdSeries, totals } = ctx;

  // Custom rules, evaluated in code against the data already on this page.
  const customRules = await listRules();
  const customHits = evaluateAlerts(customRules, {
    quotes: bundle.quotes,
    histories: bundle.histories,
    rows,
    totals,
    portfolioSeries: series,
  });
  // Log the fires so the history panel has something durable to show. Capped
  // to one entry per rule per day inside the store.
  const fired = customHits.filter((h) => h.triggered);
  if (fired.length) {
    await recordFires(
      fired.map((h) => ({
        ruleId: h.ruleId,
        subject: h.subject,
        kind: h.kind,
        detail: h.detail,
        value: h.value,
      })),
    );
  }
  const history = await listEvents(25);

  const evaluate = (rule: AlertRule): Evaluated => {
    switch (rule.kind) {
      case "weight": {
        const row = rows.find((r) => r.position.code.toUpperCase() === rule.target);
        if (!row) {
          return {
            rule,
            triggered: false,
            actual: "—",
            detail: `${rule.target} is not held.`,
            unavailable: true,
          };
        }
        return {
          rule,
          triggered: row.currentWeight > rule.threshold,
          actual: fmtPct(row.currentWeight, 2),
          detail: `Current weight ${fmtPct(row.currentWeight, 2)} vs limit ${fmtPct(rule.threshold, 2)}.`,
        };
      }
      case "market": {
        const q = bundle.quotes[rule.target];
        if (!q) {
          return { rule, triggered: false, actual: "—", detail: "No quote.", unavailable: true };
        }
        return {
          rule,
          triggered: rule.op === ">" ? q.price > rule.threshold : q.price < rule.threshold,
          actual: q.price.toFixed(2),
          detail: `${rule.target} at ${q.price.toFixed(2)} vs ${rule.op} ${rule.threshold}.`,
        };
      }
      case "fx": {
        const q = bundle.quotes["USD/TRY"];
        if (!q) {
          return { rule, triggered: false, actual: "—", detail: "No FX quote.", unavailable: true };
        }
        return {
          rule,
          triggered: Math.abs(q.changePercent) > rule.threshold,
          actual: fmtPctPoints(q.changePercent),
          detail: `Daily move ${fmtPctPoints(q.changePercent)} vs ±${rule.threshold}% limit.`,
        };
      }
      case "ma": {
        const s = usdSeries.find((x) => x.code.toUpperCase() === rule.target);
        const t = s ? technicals(s.points) : null;
        if (!t?.distanceFrom200) {
          return {
            rule,
            triggered: false,
            actual: "—",
            detail: "Not enough history for a 200DMA.",
            unavailable: true,
          };
        }
        const pct = t.distanceFrom200 * 100;
        return {
          rule,
          triggered: pct < rule.threshold,
          actual: fmtPctPoints(pct),
          detail: `${rule.target} is ${fmtPctPoints(pct)} vs its 200DMA; alert at ${rule.threshold}%.`,
        };
      }
      case "drawdown": {
        const dd = maxDrawdown(cumulative(toReturns(series.map((p) => p.close)))) * 100;
        return {
          rule,
          triggered: dd < rule.threshold,
          actual: fmtPctPoints(dd),
          detail: `Max drawdown ${fmtPctPoints(dd)} vs ${rule.threshold}% limit.`,
        };
      }
    }
  };

  const results = DEFAULT_ALERTS.filter((r) => r.enabled).map(evaluate);
  const firing = results.filter((r) => r.triggered);
  const clear = results.filter((r) => !r.triggered && !r.unavailable);
  const unavailable = results.filter((r) => r.unavailable);

  return (
    <div className="flex flex-col gap-3">
      <Panel bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] lg:grid-cols-4">
          <Kpi label="Rules Active" value={String(results.length)} />
          <Kpi label="Triggered" value={String(firing.length)} tone={firing.length ? "neg" : "flat"} />
          <Kpi label="Clear" value={String(clear.length)} tone="pos" />
          <Kpi label="Unavailable" value={String(unavailable.length)} tone="amber" />
        </div>
      </Panel>

      {bundle.status === "UNAVAILABLE" && (
        <Note tone="warn">
          No real quotes are available right now, so the rules below cannot be evaluated.
        </Note>
      )}

      <Panel
        title="Custom Alerts"
        subtitle="price, moving averages, technical, portfolio — all evaluated in code"
        bodyClassName="p-0"
      >
        <RuleBuilder />
        {customHits.length > 0 && (
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Subject</th>
                <th className="tl">Rule</th>
                <th className="tl">Measured</th>
                <th className="tl">State</th>
              </tr>
            </thead>
            <tbody>
              {customHits.map((h) => (
                <tr key={h.ruleId}>
                  <td className="tl font-semibold">{h.subject}</td>
                  <td className="tl text-[10px] text-[var(--ink-3)]">
                    {h.kind.replace(/_/g, " ")}
                  </td>
                  <td className="tl text-[10.5px]">{h.detail}</td>
                  <td className="tl">
                    {!h.evaluated ? (
                      <Chip tone="warn">N/A</Chip>
                    ) : h.triggered ? (
                      <Chip tone="neg">TRIGGERED</Chip>
                    ) : (
                      <Chip tone="pos">CLEAR</Chip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Alert History" subtitle="one entry per rule per day" bodyClassName="p-0">
        {history.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-[var(--ink-3)]">
            Nothing has fired yet.
          </div>
        ) : (
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">When</th>
                <th className="tl">Subject</th>
                <th className="tl">Rule</th>
                <th className="tl">Detail</th>
              </tr>
            </thead>
            <tbody>
              {history.map((e) => (
                <tr key={e.id}>
                  <td className="tl text-[10px] text-[var(--ink-3)]">
                    {new Date(e.at).toLocaleString("en-GB")}
                  </td>
                  <td className="tl font-semibold">{e.subject}</td>
                  <td className="tl text-[10px]">{e.kind.replace(/_/g, " ")}</td>
                  <td className="tl text-[10.5px] text-[var(--ink-3)]">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Alert Rules" bodyClassName="p-0">
        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">Status</th>
              <th className="tl">Rule</th>
              <th className="tl">Target</th>
              <th>Threshold</th>
              <th>Actual</th>
              <th className="tl">Detail</th>
            </tr>
          </thead>
          <tbody>
            {[...firing, ...clear, ...unavailable].map((r) => (
              <tr key={r.rule.id}>
                <td className="tl">
                  {r.unavailable ? (
                    <Chip tone="warn">N/A</Chip>
                  ) : r.triggered ? (
                    <Chip tone="neg">TRIGGERED</Chip>
                  ) : (
                    <Chip tone="pos">CLEAR</Chip>
                  )}
                </td>
                <td className="tl text-[var(--ink)]">{r.rule.label}</td>
                <td className="tl text-[var(--ink-2)]">{r.rule.target}</td>
                <td className="text-[var(--ink-3)]">
                  {r.rule.unit === "weight"
                    ? fmtPct(r.rule.threshold, 1)
                    : r.rule.unit === "pct"
                      ? `${r.rule.threshold}%`
                      : r.rule.threshold}
                </td>
                <td className={r.triggered ? "neg font-semibold" : ""}>{r.actual}</td>
                <td className="tl max-w-[420px] whitespace-normal text-[10.5px] leading-snug text-[var(--ink-3)]">
                  {r.detail}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
          Alerts are evaluated on page load — this build has no background scheduler or
          notification delivery. Rules live in{" "}
          <code className="text-[var(--amber)]">src/lib/portfolio/settings.ts</code>.
        </div>
      </Panel>
    </div>
  );
}
