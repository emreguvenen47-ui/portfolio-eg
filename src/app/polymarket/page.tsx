import { Chip, Note, Panel } from "@/components/shell/ui";
import { getHealth, discoverMarkets, REGION_NOTE } from "@/lib/providers/polymarket";
import { MARKET_CATEGORIES } from "@/lib/events/market-categories";
import { MarketTable } from "@/components/polymarket/market-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Polymarket" };

/**
 * Standalone prediction-market intelligence. Read-only: this page discovers
 * and displays public market data and has no wallet, order or account path of
 * any kind. Every request runs server-side.
 */
export default async function PolymarketPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await props.searchParams;
  const active =
    (typeof sp.c === "string" && MARKET_CATEGORIES.find((c) => c.id === sp.c)) ||
    MARKET_CATEGORIES[0];

  const health = await getHealth();
  const markets = health.marketDataOperational
    ? await discoverMarkets(active.id, active.query)
    : [];

  return (
    <div className="flex flex-col gap-3">
      <Note tone={health.marketDataOperational ? "info" : "warn"}>
        <span>
          <strong>Market-implied probability, not objective probability.</strong> These are
          prices traders are paying, which reflect positioning and risk appetite as much as
          belief. Read-only: no wallet, no orders, no account.
        </span>
      </Note>

      <Panel title="Provider Health" subtitle="read-only data availability, checked separately per host" bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-5">
          {([
            ["Gamma (discovery)", health.gammaReachable],
            ["CLOB (history)", health.clobReachable],
            ["Data API", health.dataApiReachable],
            ["Trading region blocked", health.tradingRegionBlocked],
            ["Market data operational", health.marketDataOperational],
          ] as const).map(([label, ok]) => {
            // The two negative-sense rows read the opposite way round.
            const isBlockRow = label === "Trading region blocked";
            const good = isBlockRow ? !ok : ok;
            return (
              <div key={label} className="px-3 py-2">
                <div className="text-[9.5px] text-[var(--ink-3)]">{label}</div>
                <div className={good ? "text-[12px] text-emerald-400" : "text-[12px] text-rose-400"}>
                  {ok ? "YES" : "NO"}
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] leading-snug text-[var(--ink-3)]">
          {health.detail} Checked {health.checkedAt.slice(0, 16).replace("T", " ")}. Trading
          restriction and read-only data availability are tracked separately — this section stays
          on whenever discovery works.
        </div>
      </Panel>

      {!health.marketDataOperational ? (
        <Panel title="Markets" bodyClassName="p-0">
          <div className="px-3 py-4 text-[11px] leading-snug text-[var(--ink-3)]">
            <Chip tone="warn">POLYMARKET READ-ONLY DATA UNAVAILABLE FROM CURRENT SERVER</Chip>
            <p className="mt-2">{REGION_NOTE}</p>
          </div>
        </Panel>
      ) : (
        <MarketTable markets={markets} categories={MARKET_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))} active={active.id} />
      )}
    </div>
  );
}
