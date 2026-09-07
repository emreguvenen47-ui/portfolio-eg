import Link from "next/link";
import { Chip, Empty, Kpi, Panel } from "@/components/shell/ui";
import { getMemberProfile } from "@/lib/research/congress-member";
import { PERF_MIN_SAMPLE } from "@/lib/research/congress-perf";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ politician: string }> }) {
  const { politician } = await props.params;
  return { title: `${decodeURIComponent(politician)} · Congress Trading` };
}

/**
 * MEMBER PROFILE — a stock-page-style layout for one politician: who they
 * are (chamber/state/office), their full disclosure history (buys AND
 * sells, chronological, each linking its official filing), a deterministic
 * "likely still held" read from the last filed action per ticker, and their
 * performance ranking against the S&P 500 when they clear the sample bar.
 * Everything here is a disclosure trail — never presented as a live portfolio.
 */
export default async function MemberProfilePage(props: { params: Promise<{ politician: string }> }) {
  const { politician: raw } = await props.params;
  const name = decodeURIComponent(raw);
  const profile = await getMemberProfile(name).catch(() => null);

  if (!profile) {
    return (
      <div className="flex flex-col gap-3">
        <Link href="/congress" className="text-[11px] text-[var(--ink-3)] hover:text-[var(--amber)]">← Congress</Link>
        <Panel title={name}><Empty>No disclosure on file for this name in the ledger.</Empty></Panel>
      </div>
    );
  }

  const { chamber, state, office, rows, perf, holdings, firstFiling, lastFiling } = profile;
  const buys = rows.filter((r) => r.side === "BUY").length;
  const sells = rows.filter((r) => r.side === "SELL").length;
  const heldNow = holdings.filter((h) => h.status === "LIKELY HELD");
  const rankEligible = perf && perf.scored >= PERF_MIN_SAMPLE;

  return (
    <div className="flex flex-col gap-3">
      {/* Header — office stated plainly, like a stock ticker header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-[var(--line)] bg-[var(--panel,transparent)] px-3 py-2">
        <Link href="/congress" className="text-[11px] text-[var(--ink-3)] hover:text-[var(--amber)]">← Congress</Link>
        <div className="flex h-9 w-9 items-center justify-center rounded bg-[var(--amber)]/10 text-[13px] font-bold tracking-tight text-[var(--amber)]">
          {profile.politician.split(" ").map((w) => w[0]).slice(0, 2).join("")}
        </div>
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold leading-tight">{profile.politician}</h1>
          <div className="text-[10px] text-[var(--ink-3)]">
            {office} · {chamber}{state ? ` (${state})` : ""}
          </div>
        </div>
        <div className="ml-auto text-right text-[10px] text-[var(--ink-3)]">
          filings {firstFiling ?? "?"} → {lastFiling ?? "?"}
        </div>
      </div>

      {/* Decision-bar-style KPI strip */}
      <Panel bodyClassName="p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Total filings" value={String(rows.length)} />
          <Kpi label="Buys" value={String(buys)} tone="pos" />
          <Kpi label="Sells" value={String(sells)} tone="neg" />
          <Kpi label="Likely held now" value={String(heldNow.length)} sub="last action = BUY, no later SELL" />
          <Kpi
            label="Median excess vs SPY"
            value={rankEligible ? `${perf!.medianExcessPct! > 0 ? "+" : ""}${perf!.medianExcessPct}%` : "N/A"}
            tone={rankEligible ? (perf!.medianExcessPct! >= 0 ? "pos" : "neg") : undefined}
            sub={rankEligible ? `${perf!.scored} scored buys, 6M horizon` : `needs ${PERF_MIN_SAMPLE}+ scored buys`}
          />
          <Kpi
            label="Hit rate vs SPY"
            value={rankEligible ? `${Math.round(perf!.hitRateVsSpy! * 100)}%` : "N/A"}
            sub={rankEligible && perf!.best ? `best ${perf!.best.ticker} +${perf!.best.excessPct}%` : undefined}
          />
        </div>
      </Panel>

      {/* Likely-held-now — the closest thing to "what's in their portfolio" */}
      <Panel
        title="Estimated Current Positions"
        subtitle="deterministic read of the LAST filed action per ticker — a disclosure trail, not a verified live portfolio"
        bodyClassName="p-0"
      >
        {holdings.length === 0 ? (
          <Empty>No filings to derive a position from.</Empty>
        ) : (
          <table className="grid-table">
            <thead>
              <tr>
                <th className="tl">Ticker</th>
                <th className="tl">Company</th>
                <th className="tl">Status</th>
                <th className="tl">Last action</th>
                <th>Buys</th>
                <th>Sells</th>
                <th className="tl">Filing</th>
              </tr>
            </thead>
            <tbody>
              {holdings.slice(0, 60).map((h) => (
                <tr key={h.ticker}>
                  <td className="tl font-semibold">
                    <Link href={`/ticker/${h.ticker}`} className="hover:text-[var(--amber)]">{h.ticker}</Link>
                  </td>
                  <td className="tl max-w-[200px] truncate text-[10px] text-[var(--ink-3)]" title={h.company ?? ""}>{h.company ?? "—"}</td>
                  <td className="tl">
                    <Chip tone={h.status === "LIKELY HELD" ? "pos" : "neutral"}>{h.status}</Chip>
                  </td>
                  <td className="tl tabular-nums">
                    <span className={h.lastAction === "BUY" ? "text-emerald-400" : "text-rose-400"}>{h.lastAction}</span>{" "}
                    {h.lastActionDate}
                  </td>
                  <td className="tabular-nums text-emerald-400">{h.totalBuys}</td>
                  <td className="tabular-nums text-rose-400">{h.totalSells}</td>
                  <td className="tl text-[10px]">
                    {h.sourceUrl ? <a href={h.sourceUrl} target="_blank" rel="noreferrer" className="text-cyan-300/80 hover:underline">filing ↗</a> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {/* Full chronological trade history */}
      <Panel title="Full Disclosure History" subtitle={`${rows.length} filings, newest first`} bodyClassName="p-0">
        <div className="max-h-[600px] overflow-y-auto">
          <table className="grid-table">
            <thead className="sticky top-0 bg-[var(--panel,#0a0a0a)]">
              <tr>
                <th className="tl">Ticker</th>
                <th className="tl">Side</th>
                <th className="tl">Owner</th>
                <th className="tl">Transaction</th>
                <th className="tl">Disclosed</th>
                <th>Lag</th>
                <th className="tl">Reported value</th>
                <th className="tl">Filing</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="tl font-semibold">
                    <Link href={`/ticker/${r.ticker}`} className="hover:text-[var(--amber)]">{r.ticker}</Link>
                    {r.company && <span className="ml-1.5 text-[9px] text-[var(--ink-3)]">{r.company.slice(0, 30)}</span>}
                  </td>
                  <td className="tl"><Chip tone={r.side === "BUY" ? "pos" : "neg"}>{r.side}</Chip></td>
                  <td className="tl text-[10px] text-[var(--ink-3)]">{r.owner ?? "—"}</td>
                  <td className="tl tabular-nums">{r.transactionDate}</td>
                  <td className="tl tabular-nums text-[var(--ink-3)]">{r.disclosureDate || "—"}</td>
                  <td className="tabular-nums">{r.disclosureLagDays === null ? "—" : `${r.disclosureLagDays}d`}</td>
                  <td className="tl text-[10px] tabular-nums">
                    {r.valueLow === null ? "N/A" : `$${r.valueLow.toLocaleString()} – $${(r.valueHigh ?? r.valueLow).toLocaleString()}`}
                  </td>
                  <td className="tl text-[10px]">
                    {r.sourceUrl ? <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="text-cyan-300/80 hover:underline">filing ↗</a> : (r.sourceProvider ?? "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] leading-snug text-[var(--ink-3)]">
          Legally required, lagged disclosures — never insider trading. Reported values are ranges, not exact
          figures. &quot;Likely held&quot; is inferred purely from filing order and can be wrong (e.g. a holding
          from before the ledger&apos;s coverage window, or shares moved outside a reportable transaction).
        </div>
      </Panel>
    </div>
  );
}
