import Link from "next/link";
import { getContext } from "@/lib/server/context";
import { Chip, Empty, Note, Panel, StatusBadge } from "@/components/shell/ui";
import { assessRegime, portfolioImpacts } from "@/lib/portfolio/analytics";
import { MARKET_INSTRUMENTS } from "@/lib/portfolio/config";
import { fmtNum, fmtPctPoints, signClass } from "@/lib/format";
import { ScannerShell } from "@/components/markets/scanner-shell";
import { NewsImpact } from "@/components/markets/news-impact";

export const dynamic = "force-dynamic";

/** % change between the last close and the close `bars` sessions earlier. */
function changeOver(candles: { date: string; close: number }[] | undefined, bars: number) {
  if (!candles || candles.length < 2) return null;
  const last = candles[candles.length - 1].close;
  const ref = candles[Math.max(0, candles.length - 1 - bars)]?.close;
  return ref && ref > 0 ? (last / ref - 1) * 100 : null;
}

/** Venue clock for a quote's market timestamp — when the price actually printed. */
function fmtClock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleTimeString("en-GB", { timeZone: "UTC" });
}

function changeYtd(candles: { date: string; close: number }[] | undefined) {
  if (!candles || candles.length < 2) return null;
  const start = `${new Date().getUTCFullYear()}-01-01`;
  const ref = candles.find((c) => c.date >= start)?.close;
  const last = candles[candles.length - 1].close;
  return ref && ref > 0 ? (last / ref - 1) * 100 : null;
}

export default async function MarketsPage() {
  const ctx = await getContext({ markets: true });
  if (ctx.error) return <Panel title="Error"><Note tone="warn">{ctx.error}</Note></Panel>;

  const { bundle, portfolio } = ctx;
  const portfolioLabel = "portfolio EG";
  // scanner tab state handled client-side; render placeholder server-side
  const regime = assessRegime(bundle.quotes);
  const impacts = portfolioImpacts(bundle.quotes, portfolio);

  return (
    <div className="flex flex-col gap-3">
      {bundle.status === "UNAVAILABLE" && (
        <Note tone="warn">
          <span>
            <strong>NO DATA.</strong> No configured provider can price these instruments right
            now. Levels are omitted rather than estimated.
          </span>
        </Note>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_340px]">
        <div className="text-[12px] font-semibold text-[var(--ink)]">{portfolioLabel}</div>
        <Panel
          title="Market Monitor"
          actions={<StatusBadge status={bundle.status} />}
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Instrument</th>
                  <th className="tl">Symbol</th>
                  <th>Last</th>
                  <th>Daily</th>
                  <th>Weekly</th>
                  <th>Monthly</th>
                  <th>YTD</th>
                  <th className="tl">Source</th>
                  <th className="tl">Status</th>
                  <th className="tl">Price time</th>
                </tr>
              </thead>
              <tbody>
                {MARKET_INSTRUMENTS.map((m) => {
                  const q = bundle.quotes[m.key] ?? bundle.quotes[m.symbol];
                  const h = bundle.histories[m.symbol];
                  const w = changeOver(h, 5);
                  const mo = changeOver(h, 21);
                  const ytd = changeYtd(h);
                  return (
                    <tr key={m.key}>
                      <td className="tl">
                        <span className="text-[var(--ink)]">{m.label}</span>
                        {m.isProxy && (
                          <span
                            className="ml-1 text-[9px] text-[var(--warn)]"
                            title={m.proxyNote}
                          >
                            proxy
                          </span>
                        )}
                      </td>
                      <td className="tl text-[10px] text-[var(--ink-3)]">{m.symbol}</td>
                      <td className="font-semibold">
                        {q ? fmtNum(q.price, m.decimals) : "—"}
                      </td>
                      <td className={signClass(q?.changePercent)}>
                        {q ? fmtPctPoints(q.changePercent) : "—"}
                      </td>
                      <td className={signClass(w)}>{fmtPctPoints(w)}</td>
                      <td className={signClass(mo)}>{fmtPctPoints(mo)}</td>
                      <td className={signClass(ytd)}>{fmtPctPoints(ytd)}</td>
                      <td className="tl text-[10px] capitalize text-[var(--ink-3)]">
                        {q?.provider ?? "—"}
                      </td>
                      <td className="tl">
                        <StatusBadge
                          status={q?.status ?? "UNAVAILABLE"}
                          reason={q?.fallbackReason}
                        />
                      </td>
                      <td className="tl text-[10px] tabular-nums text-[var(--ink-3)]">
                        {q ? fmtClock(q.timestamp) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
            Weekly = 5 sessions, monthly = 21 sessions. Instruments marked{" "}
            <span className="text-[var(--warn)]">proxy</span> are not directly available on
            standard Twelve Data plans and use the stand-in shown.
          </div>
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel
            title="Risk Regime"
            actions={
              <Chip
                tone={
                  regime.regime === "RISK ON" ? "pos" : regime.regime === "RISK OFF" ? "neg" : "warn"
                }
              >
                {regime.regime}
              </Chip>
            }
            bodyClassName="p-0"
          >
            <ul className="divide-y divide-[var(--line-soft)]">
              {regime.signals.map((s) => (
                <li key={s.key} className="px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[11px]">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          s.vote === "on"
                            ? "bg-[var(--up)]"
                            : s.vote === "off"
                              ? "bg-[var(--down)]"
                              : "bg-[var(--ink-3)]"
                        }`}
                      />
                      {s.label}
                    </span>
                    <span className="tnum text-[11px]">{s.value}</span>
                  </div>
                  <p className="mt-0.5 pl-3 text-[10px] leading-snug text-[var(--ink-3)]">
                    {s.detail}
                  </p>
                </li>
              ))}
            </ul>
            <div className="border-t border-[var(--line)] px-3 py-2 text-[10px] text-[var(--ink-3)]">
              Score {regime.score >= 0 ? "+" : ""}
              {regime.score}. Each signal votes +1 risk-on, −1 risk-off. Two net votes flip the
              classification. Rules only — not a forecast.
            </div>
          </Panel>

          <Panel title="Portfolio Impact" bodyClassName="p-0">
            {impacts.length === 0 ? (
              <Empty>No driver moved enough today to flag an impact.</Empty>
            ) : (
              <ul className="divide-y divide-[var(--line-soft)]">
                {impacts.map((i) => (
                  <li key={i.driver} className="px-3 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px]">
                        {i.driver}{" "}
                        <span className={i.direction === "up" ? "pos" : "neg"}>
                          {i.direction === "up" ? "↑" : "↓"} {i.move}
                        </span>
                      </span>
                      <Chip tone={i.sentiment === "positive" ? "pos" : "neg"}>
                        {i.sentiment === "positive" ? "supportive" : "headwind"}
                      </Chip>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {i.affected.map((c) => (
                        <Link key={c} href={`/positions/${c}`}>
                          <Chip>{c}</Chip>
                        </Link>
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] leading-snug text-[var(--ink-3)]">{i.note}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Panel
        title="News Impact"
        subtitle="Live headlines mapped onto holdings, priced at today's actual move"
        bodyClassName="p-0"
      >
        <NewsImpact />
      </Panel>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[1fr_340px]">
        <Panel title="Scanner" bodyClassName="p-2">
          <div>
            <ScannerShell />
          </div>
        </Panel>

        <Panel title="Benchmarks" bodyClassName="p-2">
          <div className="text-xs space-y-2">
            {(() => {
              const periods: [string, number][] = [["1M", 22], ["3M", 66], ["6M", 132], ["1Y", 253]];
              const eurUsdPct = changeOver(bundle.histories["EUR/USD"], 21) ?? 0;
              const usdTryPct = changeOver(bundle.histories["USD/TRY"], 21) ?? 0;
              return (
                <div>
                  {periods.map(([label, days]) => {
                    const spxUsd = changeOver(bundle.histories["SPX"], days) ?? 0;
                    // convert percentages (e.g. 1.23) to decimals
                    const spxUsdDec = spxUsd / 100;
                    const eurUsdDec = (changeOver(bundle.histories["EUR/USD"], days) ?? 0) / 100;
                    const usdTryDec = (changeOver(bundle.histories["USD/TRY"], days) ?? 0) / 100;

                    const spxEurDec = (1 + spxUsdDec) / (1 + eurUsdDec) - 1;
                    const spxTryDec = (1 + spxUsdDec) * (1 + usdTryDec) - 1;

                    return (
                      <div key={label} className="flex items-center justify-between">
                        <div className="text-[12px]">SPX {label}</div>
                        <div className="tnum">
                          USD {fmtPctPoints(spxUsd)} • EUR {fmtPctPoints(spxEurDec * 100)} • TRY {fmtPctPoints(spxTryDec * 100)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </Panel>
      </div>
    </div>
  );
}
