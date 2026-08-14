import Link from "next/link";
import { notFound } from "next/navigation";
import { Chip, Empty, Kpi, Note, Panel } from "@/components/shell/ui";
import { TradePanel } from "@/components/virtual/trade-panel";
import { OptionPanel } from "@/components/virtual/option-panel";
import { tradeNotional } from "@/lib/server/virtual-portfolios";
import { getVirtual } from "@/lib/server/virtual-portfolios";
import { valueVirtual } from "@/lib/portfolio/virtual-analytics";
import { getQuotes } from "@/lib/providers";
import { getOptionChain } from "@/lib/providers/yahoo-options";
import { fmtPctPoints, signClass } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function VirtualDetail(props: PageProps<"/virtual/[id]">) {
  const { id } = await props.params;
  const portfolio = await getVirtual(id);
  if (!portfolio) notFound();

  const tickers = [...new Set(portfolio.trades.map((t) => t.ticker))];

  /**
   * Option contracts are priced from their own chain, not the underlying.
   *
   * One chain request per (underlying, expiry) still open — the same request
   * covers every strike on it, so a spread costs one fetch rather than four.
   * A contract the venue no longer lists resolves to null and the row reads
   * N/A, which is the truth: there is no price for a strike that has expired.
   */
  const openLegs = new Map<string, { symbol: string; expiry: string }>();
  for (const t of portfolio.trades) {
    if (t.option) openLegs.set(`${t.ticker}:${t.option.expiry}`, { symbol: t.ticker, expiry: t.option.expiry });
  }

  const [quotes, chains] = await Promise.all([
    tickers.length ? getQuotes(tickers) : Promise.resolve({}),
    Promise.all(
      [...openLegs.values()].map((l) =>
        getOptionChain(l.symbol, l.expiry).catch(() => null),
      ),
    ),
  ]);

  const optionMarks: Record<string, number | null> = {};
  for (const chain of chains) {
    if (!chain) continue;
    for (const q of [...chain.calls, ...chain.puts]) optionMarks[q.contract] = q.mark;
  }

  const v = valueVirtual(portfolio, quotes, optionMarks);

  const money = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: v.currency,
      maximumFractionDigits: 2,
    }).format(n);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/virtual" className="text-[11px] text-[var(--ink-3)] hover:text-[var(--amber)]">
          ← Virtual Portfolios
        </Link>
        <h1 className="text-[16px] font-semibold">{portfolio.name}</h1>
        <Chip tone="info">PAPER</Chip>
        <Link
          href={`/performance?portfolio=v:${portfolio.id}`}
          className="ml-auto rounded-sm border border-[var(--line)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[var(--ink-3)] hover:border-[var(--amber)] hover:text-[var(--amber)]"
        >
          Performance
        </Link>
      </div>

      {v.unavailable.length > 0 && (
        <Note tone="warn">
          <span>
            <strong>NO PRICE:</strong> {v.unavailable.join(", ")} — held but unpriced, so excluded
            from value and P&amp;L rather than estimated.
          </span>
        </Note>
      )}

      <Panel bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Total Value" value={money(v.totalValue)} sub={`cash ${money(v.cash)}`} />
          <Kpi
            label="Total P&L"
            value={money(v.totalPnl)}
            sub={fmtPctPoints(v.returnPct)}
            tone={v.totalPnl >= 0 ? "pos" : "neg"}
          />
          <Kpi
            label="Unrealised"
            value={money(v.unrealizedPnl)}
            tone={v.unrealizedPnl >= 0 ? "pos" : "neg"}
          />
          <Kpi
            label="Realised"
            value={money(v.realizedPnl)}
            sub="FIFO"
            tone={v.realizedPnl >= 0 ? "pos" : "neg"}
          />
          <Kpi
            label="Daily P&L"
            value={money(v.dailyPnl)}
            sub={fmtPctPoints(v.dailyPct)}
            tone={v.dailyPnl >= 0 ? "pos" : "neg"}
          />
          <Kpi label="Cost Basis" value={money(v.costBasis)} sub={`${v.positions.length} open`} />
        </div>
      </Panel>

      <Panel title="Record Trade" bodyClassName="p-0">
        <TradePanel id={portfolio.id} currency={portfolio.currency} />
      </Panel>

      <OptionPanel id={portfolio.id} currency={portfolio.currency} />

      <Panel title="Positions" bodyClassName="p-0">
        {v.positions.length === 0 ? (
          <Empty>No open positions. Record a BUY above.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Ticker</th>
                  <th>Shares</th>
                  <th>Avg Cost</th>
                  <th>Last</th>
                  <th>Value</th>
                  <th>Weight</th>
                  <th>Daily</th>
                  <th>Unrealised</th>
                  <th>Realised</th>
                </tr>
              </thead>
              <tbody>
                {v.positions.map((p) => (
                  <tr key={p.ticker}>
                    <td className="tl font-semibold">
                      <Link
                        href={`/ticker/${encodeURIComponent(p.ticker)}`}
                        className="hover:text-[var(--amber)]"
                      >
                        {p.ticker}
                      </Link>
                    </td>
                    <td className="tabular-nums">{p.shares.toFixed(4).replace(/\.?0+$/, "")}</td>
                    <td className="tabular-nums">{money(p.averageCost)}</td>
                    <td className="tabular-nums">
                      {p.currentPrice === null ? "—" : money(p.currentPrice)}
                    </td>
                    <td className="tabular-nums">{p.available ? money(p.value) : "—"}</td>
                    <td className="tabular-nums text-[var(--ink-3)]">
                      {p.available ? `${(p.weight * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className={cn("tabular-nums", signClass(p.dailyPct))}>
                      {p.dailyPct === null ? "—" : fmtPctPoints(p.dailyPct)}
                    </td>
                    <td className={cn("tabular-nums", signClass(p.unrealizedPnl))}>
                      {p.available
                        ? `${money(p.unrealizedPnl)} (${fmtPctPoints(p.unrealizedPnlPct)})`
                        : "—"}
                    </td>
                    <td className={cn("tabular-nums", signClass(p.realizedPnl))}>
                      {p.realizedPnl === 0 ? "—" : money(p.realizedPnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel title="Open Lots" subtitle="each purchase tracked separately" bodyClassName="p-0">
          {v.positions.every((p) => p.lots.length === 0) ? (
            <Empty>No open lots.</Empty>
          ) : (
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Ticker</th>
                  <th className="tl">Bought</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Now</th>
                  <th>Lot P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {v.positions.flatMap((p) =>
                  p.lots.map((l) => (
                    <tr key={l.tradeId}>
                      <td className="tl font-semibold">{l.ticker}</td>
                      <td className="tl text-[10px] text-[var(--ink-3)]">{l.date}</td>
                      <td className="tabular-nums">
                        {l.quantity.toFixed(4).replace(/\.?0+$/, "")}
                      </td>
                      <td className="tabular-nums">{money(l.price)}</td>
                      <td className="tabular-nums">
                        {l.currentPrice === null ? "—" : money(l.currentPrice)}
                      </td>
                      <td className={cn("tabular-nums", signClass(l.pnl))}>
                        {l.currentPrice === null
                          ? "—"
                          : `${money(l.pnl)} (${fmtPctPoints(l.pnlPct)})`}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Transaction History" bodyClassName="p-0">
          {portfolio.trades.length === 0 ? (
            <Empty>No trades recorded.</Empty>
          ) : (
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Date</th>
                  <th className="tl">Side</th>
                  <th className="tl">Ticker</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Fees</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {[...portfolio.trades]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((t) => (
                    <tr key={t.id}>
                      <td className="tl text-[10px] text-[var(--ink-3)]">{t.date}</td>
                      <td className="tl">
                        <Chip tone={t.side === "BUY" ? "pos" : "neg"}>{t.side}</Chip>
                      </td>
                      <td className="tl font-semibold">{t.ticker}</td>
                      <td className="tabular-nums">
                        {t.quantity.toFixed(4).replace(/\.?0+$/, "")}
                      </td>
                      <td className="tabular-nums">{money(t.price)}</td>
                      <td className="tabular-nums text-[var(--ink-3)]">
                        {t.fees ? money(t.fees) : "—"}
                      </td>
                      <td className="tabular-nums">
                        {money(tradeNotional(t) + (t.side === "BUY" ? t.fees : -t.fees))}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
