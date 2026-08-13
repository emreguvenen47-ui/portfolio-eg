import { getContext } from "@/lib/server/context";
import { Note, Panel } from "@/components/shell/ui";
import { Watchlist } from "@/components/watchlist/watchlist";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const ctx = await getContext();
  const held = ctx.portfolio.positions
    .map((p) => p.symbol)
    .filter((s): s is string => Boolean(s));

  return (
    <div className="flex flex-col gap-3">
      <Note>
        Symbols you are monitoring but do not hold. Stored in this browser only — clearing
        site data clears the list.
      </Note>
      <Panel title="Watchlist" bodyClassName="p-0">
        <Watchlist held={held} />
      </Panel>
    </div>
  );
}
