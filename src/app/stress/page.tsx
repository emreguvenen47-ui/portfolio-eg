import { getContext } from "@/lib/server/context";
import { SampleBanner } from "@/components/shell/sample-banner";
import { Note, Panel } from "@/components/shell/ui";
import { StressLab } from "@/components/stress/stress-lab";
import { DEFAULT_SCENARIOS } from "@/lib/portfolio/settings";

export const dynamic = "force-dynamic";

export default async function StressPage() {
  const ctx = await getContext();
  if (ctx.error) return <Panel title="Error"><Note tone="warn">{ctx.error}</Note></Panel>;

  const positions = ctx.rows.map((r) => ({
    code: r.position.code,
    name: r.position.name,
    value: r.value,
    weight: r.currentWeight,
    currencyCode: r.position.currencyCode,
  }));

  return (
    <div className="flex flex-col gap-3">
      <SampleBanner portfolio={ctx.portfolio} />
      <Note tone="warn">
        <span>
          <strong>These are scenarios, not forecasts.</strong> Each result is deterministic
          arithmetic on the shocks you specify — no probability is attached to any of them, and
          the absence of a scenario here says nothing about its likelihood. Second-order
          effects (correlation shifts, liquidity gaps, financing stress) are not modelled.
        </span>
      </Note>

      <StressLab
        positions={positions}
        scenarios={DEFAULT_SCENARIOS}
        totalValue={ctx.totals.value}
      />
    </div>
  );
}
