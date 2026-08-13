import { Note, Panel } from "@/components/shell/ui";
import { WhatIfSimulator } from "@/components/whatif/simulator";
import { getContext } from "@/lib/server/context";
import { fromPortfolio } from "@/lib/portfolio/what-if";

export const dynamic = "force-dynamic";

export default async function WhatIfPage() {
  const ctx = await getContext();
  if (ctx.error) {
    return (
      <Panel title="Error">
        <Note tone="warn">{ctx.error}</Note>
      </Panel>
    );
  }

  return <WhatIfSimulator initial={fromPortfolio(ctx.rows)} />;
}
