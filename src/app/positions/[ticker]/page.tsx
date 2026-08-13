import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/server/context";
import { Chip, Kpi, Note, Panel, StatusBadge } from "@/components/shell/ui";
import { AssetChart } from "@/components/charts/asset-chart";
import { technicals } from "@/lib/portfolio/analytics";
import { buildTheses, THESIS_STATUS_COLOR } from "@/lib/portfolio/theses";
import { fmtNum, fmtPct, fmtPctPoints, fmtPp, fmtUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AssetDetail(props: PageProps<"/positions/[ticker]">) {
  const { ticker } = await props.params;
  const code = decodeURIComponent(ticker).toUpperCase();
  const ctx = await getContext();
  if (ctx.error) return <Panel title="Error"><Note tone="warn">{ctx.error}</Note></Panel>;

  const row = ctx.rows.find((r) => r.position.code.toUpperCase() === code);
  // Not a workbook holding — could still be a real ticker (a manual add in a
  // saved AI portfolio, or just something the user clicked). The generic
  // ticker page handles any symbol, so send them there rather than 404.
  if (!row) redirect(`/ticker/${encodeURIComponent(code)}`);

  const p = row.position;
  const points = ctx.usdSeries.find((s) => s.code === p.code)?.points ?? [];
  const tech = technicals(points);
  const rc = ctx.risk.riskContributions.find((x) => x.code === p.code);
  const thesis = buildTheses(ctx.portfolio).find((t) => t.code === p.code);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/positions" className="text-[11px] text-[var(--ink-3)] hover:text-[var(--amber)]">
          ← Positions
        </Link>
        <h1 className="text-[16px] font-semibold">{p.code}</h1>
        <span className="text-[12px] text-[var(--ink-2)]">{p.name}</span>
        <Chip tone="neutral">{p.category || p.assetClass}</Chip>
        <Chip tone="neutral">{p.currencyCode}</Chip>
        {p.isProxy && (
          <Chip tone="warn" title={p.proxyNote}>
            PROXY: {p.symbol}
          </Chip>
        )}
        {p.kind === "cash_fund" && (
          <Chip tone="info" title={p.proxyNote}>
            NOT EXCHANGE-TRADED
          </Chip>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={`/ticker/${encodeURIComponent(p.symbol ?? p.code)}`}
            className="rounded-sm border border-[var(--line)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[var(--ink-3)] hover:border-[var(--amber)] hover:text-[var(--amber)]"
          >
            Full chart
          </Link>
          <StatusBadge status={ctx.bundle.status} />
        </div>
      </div>

      {p.kind === "cash_fund" && (
        <Note>
          <span>
            {p.code} is a money-market fund, not an ETF. It has no market quote: the series
            below is a TL accrual at {fmtPct(ctx.settings.ppfTlYield, 1)} per annum translated
            into USD at the prevailing USD/TRY, which is precisely why it carries FX risk in
            USD terms. See the <Link href="/currencies" className="text-[var(--amber)] underline">Currencies</Link>{" "}
            module.
          </span>
        </Note>
      )}

      <Panel bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-4 lg:grid-cols-8">
          <Kpi
            label="Price (USD idx)"
            value={tech ? fmtNum(tech.last, tech.last > 500 ? 0 : 2) : "—"}
            sub={p.kind === "cash_fund" ? "accrual index" : (p.symbol ?? "")}
          />
          <Kpi
            label="Daily"
            value={fmtPctPoints(row.dailyPct * 100)}
            tone={row.dailyPct >= 0 ? "pos" : "neg"}
          />
          <Kpi label="1M" value={fmtPctPoints((tech?.ret1m ?? 0) * 100)} tone={(tech?.ret1m ?? 0) >= 0 ? "pos" : "neg"} />
          <Kpi label="3M" value={fmtPctPoints((tech?.ret3m ?? 0) * 100)} tone={(tech?.ret3m ?? 0) >= 0 ? "pos" : "neg"} />
          <Kpi label="YTD" value={fmtPctPoints((tech?.ytd ?? 0) * 100)} tone={(tech?.ytd ?? 0) >= 0 ? "pos" : "neg"} />
          <Kpi label="1Y" value={fmtPctPoints((tech?.ret1y ?? 0) * 100)} tone={(tech?.ret1y ?? 0) >= 0 ? "pos" : "neg"} />
          <Kpi label="Position Value" value={fmtUsd(row.value)} sub={`cost ${fmtUsd(row.costBasis)}`} />
          <Kpi
            label="Unrealised P&L"
            value={fmtUsd(row.unrealizedPnl)}
            sub={fmtPctPoints(row.unrealizedPnlPct * 100)}
            tone={row.unrealizedPnl >= 0 ? "pos" : "neg"}
          />
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-t border-[var(--line)] sm:grid-cols-4 lg:grid-cols-8">
          <Kpi label="Weight" value={fmtPct(row.currentWeight, 2)} />
          <Kpi label="Target Weight" value={fmtPct(row.targetWeight, 2)} />
          <Kpi
            label="Drift"
            value={fmtPp(row.drift)}
            tone={Math.abs(row.drift) > ctx.settings.driftThreshold ? "amber" : "flat"}
          />
          <Kpi
            label="Contrib. to Return"
            value={fmtPctPoints(row.contributionToReturn * 100)}
            tone={row.contributionToReturn >= 0 ? "pos" : "neg"}
          />
          <Kpi
            label="Contrib. to Risk"
            value={rc ? fmtPct(rc.pctRc, 1) : "—"}
            sub={rc ? `vs ${fmtPct(rc.weight, 1)} weight` : undefined}
            tone="amber"
            title="Share of total portfolio volatility, from the covariance matrix. Not the same as allocation weight."
          />
          <Kpi label="Volatility (1Y)" value={tech ? fmtPct(tech.annualVol, 1) : "—"} sub={`Excel: ${fmtPct(p.volatility, 1)}`} />
          <Kpi
            label="From 52w High"
            value={tech ? fmtPctPoints((tech.distanceFromHigh ?? 0) * 100) : "—"}
            tone={(tech?.distanceFromHigh ?? 0) < -0.1 ? "neg" : "flat"}
          />
          <Kpi
            label="vs 200DMA"
            value={tech?.distanceFrom200 != null ? fmtPctPoints(tech.distanceFrom200 * 100) : "—"}
            tone={(tech?.distanceFrom200 ?? 0) >= 0 ? "pos" : "neg"}
          />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_360px]">
        <Panel title={`${p.code} — Price & Moving Averages`} bodyClassName="p-0">
          <AssetChart points={points} />
          <div className="grid grid-cols-3 divide-x divide-[var(--line)] border-t border-[var(--line)]">
            <Kpi label="20 DMA" value={tech?.sma20 ? fmtNum(tech.sma20, 2) : "—"} />
            <Kpi label="50 DMA" value={tech?.sma50 ? fmtNum(tech.sma50, 2) : "—"} />
            <Kpi label="200 DMA" value={tech?.sma200 ? fmtNum(tech.sma200, 2) : "—"} />
          </div>
          <div className="grid grid-cols-2 divide-x divide-[var(--line)] border-t border-[var(--line)]">
            <Kpi label="52w High" value={tech?.high52w ? fmtNum(tech.high52w, 2) : "—"} />
            <Kpi label="52w Low" value={tech?.low52w ? fmtNum(tech.low52w, 2) : "—"} />
          </div>
        </Panel>

        <div className="flex flex-col gap-3">
          {thesis && (
            <Panel
              title="Thesis"
              actions={
                <span className={`chip ${THESIS_STATUS_COLOR[thesis.status]}`}>
                  {thesis.status} · {thesis.confidence}
                </span>
              }
            >
              <p className="text-[11px] leading-relaxed text-[var(--ink-2)]">{thesis.thesis}</p>
              {thesis.keyIndicators.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {thesis.keyIndicators.map((k) => (
                    <Chip key={k}>{k}</Chip>
                  ))}
                </div>
              )}
              <div className="mt-2 border-t border-[var(--line)] pt-2">
                <div className="kpi-label mb-1">Invalidation</div>
                <p className="text-[10.5px] leading-relaxed text-[var(--ink-3)]">
                  {thesis.invalidation}
                </p>
              </div>
              <Link
                href="/theses"
                className="mt-2 inline-block text-[10px] text-[var(--amber)] hover:underline"
              >
                Full thesis tracker →
              </Link>
            </Panel>
          )}

          <Panel title="Why We Own It" subtitle="from the workbook">
            <p className="whitespace-pre-line text-[11px] leading-relaxed text-[var(--ink-2)]">
              {p.rationale || "No rationale recorded in the source workbook."}
            </p>
          </Panel>

          <Panel title="Risks" subtitle="from the workbook">
            <p className="whitespace-pre-line text-[11px] leading-relaxed text-[var(--ink-2)]">
              {p.risks || "No risks recorded in the source workbook."}
            </p>
          </Panel>

          {p.themes.length > 0 && (
            <Panel title="Themes">
              <div className="flex flex-wrap gap-1">
                {p.themes.map((t) => (
                  <Chip key={t} tone="amber">
                    {t}
                  </Chip>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
