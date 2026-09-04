import { Chip, Note } from "@/components/shell/ui";
import { getHealth, discoverMarkets, REGION_NOTE } from "@/lib/providers/polymarket";
import { MARKET_CATEGORIES } from "@/lib/events/market-categories";
import { PredictionBoard } from "@/components/polymarket/prediction-board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Polymarket" };

/**
 * PREDICTION MARKETS — a Polymarket-themed desk inside PORTFOLIO EG.
 * Probability-dominant cards, YES/NO contract feel, odds movement and trend
 * tracks. Read-only: this page discovers and displays public market data and
 * has no wallet, order or account path of any kind. Every request runs
 * server-side; anything the provider does not return renders as absent.
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
    <div className="flex flex-col gap-3" style={{ ["--tab-accent" as string]: "#818cf8" }}>
      {/* Desk header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-[var(--line)] px-3 py-2">
        <h1 className="text-[14px] font-semibold tracking-tight">Prediction Markets</h1>
        <span className="text-[10.5px] text-[var(--ink-3)]">
          market-implied probabilities from Polymarket — positioning and risk appetite, not objective odds
        </span>
        <div className="ml-auto flex items-center gap-2 text-[9.5px]">
          <Chip tone={health.marketDataOperational ? "pos" : "warn"}>
            {health.marketDataOperational ? "DATA LIVE" : "DATA UNAVAILABLE"}
          </Chip>
          <Chip tone="neutral">READ-ONLY</Chip>
          <span
            className="text-[var(--ink-3)]"
            title={`Gamma ${health.gammaReachable ? "up" : "down"} · CLOB ${health.clobReachable ? "up" : "down"} · Data API ${health.dataApiReachable ? "up" : "down"} · trading region ${health.tradingRegionBlocked ? "blocked" : "open"} — ${health.detail}`}
          >
            checked {health.checkedAt.slice(11, 16)} UTC
          </span>
        </div>
      </div>

      {!health.marketDataOperational ? (
        <Note tone="warn">
          <span>
            <strong>POLYMARKET READ-ONLY DATA UNAVAILABLE FROM CURRENT SERVER.</strong> {REGION_NOTE}{" "}
            Nothing is synthesized in its place.
          </span>
        </Note>
      ) : (
        <PredictionBoard
          markets={markets}
          categories={MARKET_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))}
          active={active.id}
          activeLabel={active.label}
        />
      )}

      <p className="text-[9.5px] leading-snug text-[var(--ink-3)]">
        Prices ARE the probabilities: a 63¢ YES contract is the market paying 63% implied odds. 24h/7d
        movement comes from the provider; the trend track is the official price history for the
        highest-volume markets. No wallet, no orders, no account.
      </p>
    </div>
  );
}
