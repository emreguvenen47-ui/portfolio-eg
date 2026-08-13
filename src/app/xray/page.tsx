import Link from "next/link";
import { getContext } from "@/lib/server/context";
import { SampleBanner } from "@/components/shell/sample-banner";
import { Chip, Note, Panel } from "@/components/shell/ui";
import { buildXray, lookThrough } from "@/lib/portfolio/xray";
import type { XrayBucket } from "@/lib/portfolio/xray";
import { fmtPct } from "@/lib/format";
import { getHoldings } from "@/lib/providers/etf-holdings";
import { ConfidenceBadge } from "@/components/research/confidence-badge";
import { PANEL_CONFIDENCE } from "@/lib/research/confidence";

export const dynamic = "force-dynamic";

function Bars({ rows }: { rows: XrayBucket[] }) {
  return (
    <ul className="divide-y divide-[var(--line-soft)]">
      {rows.map((x) => (
        <li key={x.label} className="px-3 py-1.5">
          <div className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="truncate text-[var(--ink-2)]" title={x.label}>
              {x.label}
            </span>
            <span className="tnum shrink-0">{fmtPct(x.total, 1)}</span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-sm bg-[var(--panel-2)]">
            <div
              className="h-full bg-[var(--amber)]/70"
              style={{ width: `${Math.min(100, x.total * 100).toFixed(2)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function XrayPage() {
  const ctx = await getContext();
  if (ctx.error)
    return (
      <Panel title="Error">
        <Note tone="warn">{ctx.error}</Note>
      </Panel>
    );

  const xray = buildXray(ctx.rows);

  // Full look-through where an issuer publishes holdings. Funds without a
  // published file contribute only their own weight and are named as gaps —
  // an unknown fund is not an empty one.
  const fundCodes = [
    ...new Set(
      ctx.rows
        .filter((r) => r.position.kind === "etf" && r.position.symbol)
        .map((r) => r.position.symbol!),
    ),
  ];
  const holdingFiles = await Promise.all(fundCodes.map((c) => getHoldings(c).catch(() => null)));
  const fundHoldings: Record<string, Record<string, number>> = {};
  const asOfDates: string[] = [];
  holdingFiles.forEach((h, i) => {
    if (!h?.available) return;
    if (h.profile.asOf) asOfDates.push(h.profile.asOf);
    fundHoldings[fundCodes[i]] = Object.fromEntries(
      h.holdings.map((x) => [x.ticker, x.weight / 100]),
    );
  });

  const covered = Object.keys(fundHoldings);
  const lt = covered.length ? lookThrough(ctx.rows, fundHoldings) : null;
  const ltConfidence = PANEL_CONFIDENCE.etfHoldings(asOfDates.sort().at(-1) ?? null);

  const dims = [
    { title: "Asset Class", rows: xray.byAssetClass },
    { title: "Region", rows: xray.byRegion },
    { title: "Currency", rows: xray.byCurrency },
    { title: "Sleeve / Category", rows: xray.byCategory },
  ];

  return (
    <div className="flex flex-col gap-3">
      <SampleBanner portfolio={ctx.portfolio} />
      {lt ? (
        <Note>
          <span>
            Look-through is active for {covered.length} fund
            {covered.length === 1 ? "" : "s"} ({covered.join(", ")}) using the issuers&apos; own
            published holdings files. Funds without a public file contribute only their sleeve
            weight and are listed as gaps below — their contents are not estimated.
          </span>
        </Note>
      ) : (
        <Note tone="warn">{xray.note}</Note>
      )}

      {lt && (
        <Panel
          title="Effective Company Exposure"
          subtitle="direct holdings plus exposure reached through funds"
          bodyClassName="p-0"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-1.5">
            <ConfidenceBadge report={ltConfidence} source="issuer holdings files" />
            {lt.uncovered.length > 0 && (
              <span className="text-[9.5px] text-[var(--ink-3)]">
                no published file for {[...new Set(lt.uncovered)].join(", ")}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Company</th>
                  <th>Direct</th>
                  <th>Via funds</th>
                  <th>Effective</th>
                  <th className="tl">Reached through</th>
                </tr>
              </thead>
              <tbody>
                {lt.holdings
                  .filter((x) => x.total >= 0.001)
                  .slice(0, 30)
                  .map((x) => (
                    <tr key={x.ticker}>
                      <td className="tl font-semibold">
                        <Link href={`/ticker/${x.ticker}`} className="hover:text-[var(--amber)]">
                          {x.ticker}
                        </Link>
                      </td>
                      <td className="tnum text-[var(--ink-3)]">
                        {x.direct > 0 ? fmtPct(x.direct, 2) : "—"}
                      </td>
                      <td className="tnum">{x.indirect > 0 ? fmtPct(x.indirect, 2) : "—"}</td>
                      <td className="tnum font-semibold">{fmtPct(x.total, 2)}</td>
                      <td className="tl text-[9.5px] text-[var(--ink-3)]">
                        {x.via.length
                          ? x.via.map((v) => `${v.fund} ${fmtPct(v.weight, 2)}`).join(" · ")
                          : "held directly"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] leading-snug text-[var(--ink-3)]">
            Each fund contributes its sleeve weight multiplied by the holding&apos;s weight
            inside that fund, so a company reached through two funds is summed once across both
            rather than double counted. Rows below 0.1% are hidden.
          </div>
        </Panel>
      )}

      <Panel
        title="Effective Exposure"
        subtitle="named exposures rolled up across sleeves"
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Exposure</th>
                <th>Direct</th>
                <th>Via holdings</th>
                <th>Total</th>
                <th className="tl">Basis</th>
              </tr>
            </thead>
            <tbody>
              {xray.effective.map((e) => (
                <tr key={e.label}>
                  <td className="tl font-semibold">{e.label}</td>
                  <td className="tnum">{fmtPct(e.weight, 1)}</td>
                  <td className="tnum text-[var(--ink-3)]" title="ETF look-through unavailable">
                    N/A
                  </td>
                  <td className="tnum font-semibold">{fmtPct(e.weight, 1)}</td>
                  <td className="tl text-[10px] text-[var(--ink-3)]">{e.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] text-[var(--ink-3)]">
          &ldquo;Via holdings&rdquo; stays N/A until a fund-holdings source is connected. It is a
          real gap, not a zero — a QQQ position does carry semiconductor exposure that this table
          cannot see.
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {dims.map((d) => (
          <Panel key={d.title} title={d.title} bodyClassName="p-0">
            <Bars rows={d.rows} />
          </Panel>
        ))}
      </div>

      <Panel
        title="Theme"
        subtitle="a sleeve counts fully toward every theme it carries, so this sums past 100%"
        bodyClassName="p-0"
      >
        <Bars rows={xray.byTheme} />
      </Panel>
    </div>
  );
}
