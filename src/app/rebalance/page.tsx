import Link from "next/link";
import { getContext } from "@/lib/server/context";
import { SampleBanner } from "@/components/shell/sample-banner";
import { Chip, Kpi, Note, Panel } from "@/components/shell/ui";
import { rebalancePlan } from "@/lib/portfolio/analytics";
import { fmtPct, fmtPp, fmtUsd, fmtUsdCompact, signClass } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RebalancePage() {
  const ctx = await getContext();
  if (ctx.error) return <Panel title="Error"><Note tone="warn">{ctx.error}</Note></Panel>;

  const { rows, settings, totals } = ctx;
  const { rows: plan, totalTurnover } = rebalancePlan(rows, settings.driftThreshold);

  const buys = plan.filter((r) => r.action === "BUY").sort((a, b) => b.amount - a.amount);
  const sells = plan.filter((r) => r.action === "SELL").sort((a, b) => b.amount - a.amount);
  const holds = plan.filter((r) => r.action === "HOLD");
  const maxDrift = Math.max(...plan.map((r) => Math.abs(r.drift)), 0);

  return (
    <div className="flex flex-col gap-3">
      <SampleBanner portfolio={ctx.portfolio} />
      <Note tone="warn">
        <span>
          <strong>Analytics only.</strong> This page computes the trades that would restore
          your target weights. It never places, routes or stages an order, and there is no
          brokerage connectivity anywhere in this application.
        </span>
      </Note>

      <Panel bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Portfolio Value" value={fmtUsd(totals.value)} />
          <Kpi
            label="Total Turnover"
            value={fmtUsd(totalTurnover)}
            sub={`${fmtPct(totals.value > 0 ? totalTurnover / totals.value : 0, 1)} of NAV`}
            tone="amber"
          />
          <Kpi label="Buys" value={String(buys.length)} sub={fmtUsdCompact(buys.reduce((s, r) => s + r.amount, 0))} tone="pos" />
          <Kpi label="Sells" value={String(sells.length)} sub={fmtUsdCompact(sells.reduce((s, r) => s + r.amount, 0))} tone="neg" />
          <Kpi label="In Band" value={String(holds.length)} sub={`±${(settings.driftThreshold * 100).toFixed(1)}pp`} />
          <Kpi label="Largest Drift" value={fmtPp(maxDrift)} tone="amber" />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Sell" subtitle="overweight vs target" bodyClassName="p-0">
          {sells.length === 0 ? (
            <div className="p-4 text-center text-[11px] text-[var(--ink-3)]">
              Nothing is overweight beyond the band.
            </div>
          ) : (
            <ActionTable rows={sells} tone="neg" />
          )}
        </Panel>
        <Panel title="Buy" subtitle="underweight vs target" bodyClassName="p-0">
          {buys.length === 0 ? (
            <div className="p-4 text-center text-[11px] text-[var(--ink-3)]">
              Nothing is underweight beyond the band.
            </div>
          ) : (
            <ActionTable rows={buys} tone="pos" />
          )}
        </Panel>
      </div>

      <Panel title="Full Rebalance Plan" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Code</th>
                <th className="tl">Asset</th>
                <th>Current %</th>
                <th>Target %</th>
                <th>Drift</th>
                <th>Current $</th>
                <th>Target $</th>
                <th className="tl">Action</th>
                <th>Amount</th>
                <th className="tl">Flag</th>
              </tr>
            </thead>
            <tbody>
              {plan.map((r) => (
                <tr key={r.code}>
                  <td className="tl">
                    <Link href={`/positions/${r.code}`} className="font-semibold hover:text-[var(--amber)]">
                      {r.code}
                    </Link>
                  </td>
                  <td className="tl max-w-[220px] truncate text-[var(--ink-2)]">{r.name}</td>
                  <td>{fmtPct(r.currentWeight, 2)}</td>
                  <td className="text-[var(--ink-3)]">{fmtPct(r.targetWeight, 2)}</td>
                  <td className={signClass(r.drift)}>{fmtPp(r.drift)}</td>
                  <td>{fmtUsdCompact(r.currentValue)}</td>
                  <td className="text-[var(--ink-3)]">{fmtUsdCompact(r.targetValue)}</td>
                  <td className="tl">
                    {r.action === "HOLD" ? (
                      <span className="text-[10px] text-[var(--ink-3)]">HOLD</span>
                    ) : (
                      <Chip tone={r.action === "BUY" ? "pos" : "neg"}>{r.action}</Chip>
                    )}
                  </td>
                  <td className={r.action === "HOLD" ? "text-[var(--ink-3)]" : "font-semibold"}>
                    {r.action === "HOLD" ? "—" : fmtUsd(r.amount)}
                  </td>
                  <td className="tl">
                    {r.flag === "IN LINE" ? (
                      <span className="text-[10px] text-[var(--ink-3)]">—</span>
                    ) : (
                      <Chip tone={r.flag === "OVERWEIGHT" ? "neg" : "info"}>{r.flag}</Chip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
          Target weights come from the workbook. A position is only actioned once its drift
          exceeds ±{(settings.driftThreshold * 100).toFixed(1)}pp, which keeps turnover — and
          therefore cost — down. Adjust the band in Settings.
        </div>
      </Panel>
    </div>
  );
}

function ActionTable({
  rows,
  tone,
}: {
  rows: {
    code: string;
    name: string;
    currentWeight: number;
    targetWeight: number;
    amount: number;
  }[];
  tone: "pos" | "neg";
}) {
  return (
    <table className="grid-table">
      <thead>
        <tr>
          <th className="tl">Code</th>
          <th>Current</th>
          <th>Target</th>
          <th>{tone === "pos" ? "Buy" : "Sell"}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.code}>
            <td className="tl">
              <Link href={`/positions/${r.code}`} className="font-semibold hover:text-[var(--amber)]">
                {r.code}
              </Link>
              <span className="ml-2 text-[10px] text-[var(--ink-3)]">{r.name}</span>
            </td>
            <td>{fmtPct(r.currentWeight, 2)}</td>
            <td className="text-[var(--ink-3)]">{fmtPct(r.targetWeight, 2)}</td>
            <td className={`font-semibold ${tone === "pos" ? "pos" : "neg"}`}>
              {fmtUsd(r.amount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
