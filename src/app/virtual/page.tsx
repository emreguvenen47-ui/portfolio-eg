import { Note, Panel } from "@/components/shell/ui";
import { VirtualPortfolioList } from "@/components/virtual/portfolio-list";
import { listPortfolios } from "@/lib/server/ai-portfolios";

export const dynamic = "force-dynamic";

export default async function VirtualPage() {
  const ai = await listPortfolios().catch(() => []);

  return (
    <div className="flex flex-col gap-3">
      <Note tone="info">
        <span>
          <strong>Paper tracking only.</strong> Trades are recorded by hand and valued at real
          market prices. Nothing here connects to a broker or places an order.
        </span>
      </Note>

      <Panel
        title="Virtual Portfolios"
        subtitle="manual BUY/SELL ledger with FIFO lot accounting"
        bodyClassName="p-0"
      >
        <VirtualPortfolioList aiPortfolios={ai.map((p) => ({ id: p.id, name: p.name }))} />
      </Panel>
    </div>
  );
}
