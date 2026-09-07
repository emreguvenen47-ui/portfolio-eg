import Link from "next/link";
import { Chip, Note, Panel } from "@/components/shell/ui";
import { CONGRESS_BLOCKER, MIN_SAMPLE, dedupe, summarise, withLag } from "@/lib/research/congress";
import { getCongressTrades } from "@/lib/research/alt-data";
import { allHealth } from "@/lib/research/congress-health";

export const dynamic = "force-dynamic";
export const metadata = { title: "Congress Trading" };

/**
 * Congressional disclosure tracking, as its own section.
 *
 * These are legally required, lagged disclosures — not insider trading, and
 * the page never uses that phrase. Transaction date and disclosure date are
 * always shown apart because the gap between them is the point.
 */
export default async function CongressPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await props.searchParams;
  const page = Math.max(1, Number(typeof sp.page === "string" ? sp.page : "1") || 1);
  const PER_PAGE = 50;
  const raw = await getCongressTrades().catch(() => []);
  const rows = dedupe(raw.map((t) => withLag(t)));
  const health = allHealth(["fmp-congress", "capitol-trades"]);
  const primary = health[0]!;
  const isStale = primary.state === "STALE" || (rows.length > 0 && primary.state !== "LIVE");
  const fmtIso = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "never");
  const cacheAge = (ms: number | null) =>
    ms === null ? "no cache" : ms < 60_000 ? `${Math.round(ms / 1000)}s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)}m` : `${(ms / 3_600_000).toFixed(1)}h`;
  const stateTone = (st: string) => (st === "LIVE" ? "pos" : st === "STALE" ? "warn" : "neg") as "pos" | "warn" | "neg";
  const windows = [
    summarise(rows, 30, "30D"),
    summarise(rows, 90, "90D"),
    summarise(rows, 365, "1Y"),
  ];

  return (
    <div className="flex flex-col gap-3">
      <Note tone="warn">
        <span>
          <strong>Lagged public disclosures, not insider trading.</strong> Members of Congress are
          required to disclose personal securities transactions within 45 days. Everything here is
          a filed disclosure, shown with both its transaction date and the date it became public.
        </span>
      </Note>

      {/* Source health — SOURCE / STATUS / HTTP / LAST SUCCESS / LAST ATTEMPT / CACHE AGE */}
      <Panel title="Source Health" subtitle="what each upstream actually said on its last attempt — never inferred" bodyClassName="p-0">
        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">Source</th>
              <th className="tl">Status</th>
              <th>HTTP</th>
              <th className="tl">Last success</th>
              <th className="tl">Last attempt</th>
              <th>Cache age</th>
              <th>Cached rows</th>
              <th className="tl">Note</th>
            </tr>
          </thead>
          <tbody>
            {health.map((h) => (
              <tr key={h.source}>
                <td className="tl font-semibold">{h.source}</td>
                <td className="tl"><Chip tone={stateTone(h.state)}>{h.state}</Chip></td>
                <td className="tabular-nums">{h.httpStatus ?? "—"}</td>
                <td className="tl tabular-nums text-[10px]">{fmtIso(h.lastSuccess)}</td>
                <td className="tl tabular-nums text-[10px]">{fmtIso(h.lastAttempt)}</td>
                <td className="tabular-nums">{cacheAge(h.cacheAgeMs)}</td>
                <td className="tabular-nums">{h.cachedRows}</td>
                <td className="tl max-w-[260px] truncate text-[9.5px] text-[var(--ink-3)]" title={h.note ?? ""}>{h.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {isStale && rows.length > 0 && (
        <Note tone="warn">
          <span>
            <strong>STALE.</strong> The upstream is currently unreachable; showing the last
            successful data. Last successful update: {fmtIso(primary.lastSuccess)}.
          </span>
        </Note>
      )}

      {rows.length === 0 ? (
        <Panel title="Congressional Trading" bodyClassName="p-0">
          <div className="px-3 py-4 text-[11px] leading-snug text-[var(--ink-3)]">
            <Chip tone="warn">N/A — NO STRUCTURED SOURCE REACHABLE</Chip>
            <p className="mt-2">{CONGRESS_BLOCKER}</p>
          </div>
        </Panel>
      ) : (
        <>
          <Panel title="Activity" bodyClassName="p-0">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="tl">Window</th>
                  <th>Buys</th>
                  <th>Sells</th>
                  <th>Members</th>
                  <th className="tl">Most bought</th>
                  <th className="tl">Most sold</th>
                  <th>Median lag</th>
                </tr>
              </thead>
              <tbody>
                {windows.map((w) => (
                  <tr key={w.window}>
                    <td className="tl font-semibold">{w.window}</td>
                    <td className="tabular-nums text-emerald-400">{w.buys}</td>
                    <td className="tabular-nums text-rose-400">{w.sells}</td>
                    <td className="tabular-nums">{w.members}</td>
                    <td className="tl text-[10px]">
                      {w.topBought.map((t) => `${t.ticker} (${t.count})`).join(", ") || "—"}
                    </td>
                    <td className="tl text-[10px]">
                      {w.topSold.map((t) => `${t.ticker} (${t.count})`).join(", ") || "—"}
                    </td>
                    <td className="tabular-nums">
                      {w.medianLagDays === null ? "N/A" : `${w.medianLagDays}d`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel
            title="Disclosure Ledger"
            subtitle={(() => {
              const dates = rows.map((r) => r.disclosureDate || r.transactionDate).filter(Boolean).sort();
              return `${rows.length} filings accumulated · covers ${dates[0] ?? "?"} → ${dates[dates.length - 1] ?? "?"} · deepens with every pull (free-tier feeds carry only the newest 25 per chamber per pull, so history grows forward, page by page)`;
            })()}
            bodyClassName="p-0"
          >
            <div className="overflow-x-auto">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th className="tl">Member</th>
                    <th className="tl">Chamber</th>
                    <th className="tl">State</th>
                    <th className="tl">Owner</th>
                    <th className="tl">Ticker</th>
                    <th className="tl">Company</th>
                    <th className="tl">Side</th>
                    <th className="tl">Transaction</th>
                    <th className="tl">Disclosed</th>
                    <th>Lag</th>
                    <th className="tl">Reported value</th>
                    <th className="tl">Filing</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice((page - 1) * PER_PAGE, page * PER_PAGE).map((r, i) => (
                    <tr key={i}>
                      <td className="tl">{r.politician}</td>
                      <td className="tl text-[10px] text-[var(--ink-3)]">{r.chamber}</td>
                      <td className="tl text-[10px] text-[var(--ink-3)]">{r.state ?? "—"}</td>
                      <td className="tl text-[10px] text-[var(--ink-3)]">{r.owner ?? "—"}</td>
                      <td className="tl font-semibold">
                        <a href={`/ticker/${r.ticker}`} className="hover:text-[var(--amber)]">{r.ticker}</a>
                      </td>
                      <td className="tl max-w-[180px] truncate text-[10px] text-[var(--ink-3)]" title={r.company ?? ""}>{r.company ?? "—"}</td>
                      <td className={r.side === "BUY" ? "tl text-emerald-400" : "tl text-rose-400"}>
                        {r.side}
                      </td>
                      <td className="tl tabular-nums">{r.transactionDate}</td>
                      <td className="tl tabular-nums text-[var(--ink-3)]">{r.disclosureDate}</td>
                      <td className="tabular-nums">
                        {r.disclosureLagDays === null ? "N/A" : `${r.disclosureLagDays}d`}
                      </td>
                      <td className="tl text-[10px]">
                        {r.valueLow === null && r.valueHigh === null
                          ? "N/A"
                          : `$${(r.valueLow ?? 0).toLocaleString()} – $${(r.valueHigh ?? 0).toLocaleString()}`}
                      </td>
                      <td className="tl text-[10px]">
                        {r.sourceUrl ? (
                          <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="text-cyan-300/80 hover:underline">filing ↗</a>
                        ) : (
                          <span className="text-[var(--ink-3)]">{r.source ?? "—"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] leading-snug text-[var(--ink-3)]">
              <span className="mr-3 inline-flex items-center gap-2">
                {page > 1 && (
                  <Link href={`/congress?page=${page - 1}`} className="rounded border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--amber)] hover:bg-white/5">← Newer</Link>
                )}
                <span className="tabular-nums">page {page} / {Math.max(1, Math.ceil(rows.length / PER_PAGE))}</span>
                {page * PER_PAGE < rows.length && (
                  <Link href={`/congress?page=${page + 1}`} className="rounded border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--amber)] hover:bg-white/5">Older →</Link>
                )}
              </span>
              Values are disclosed as ranges, never exact figures, so portfolio-level performance
              cannot be derived from them. Member performance statistics require at least{" "}
              {MIN_SAMPLE} valid trades before they are shown at all. Primary source: FMP&apos;s
              republication of the official Senate EFD / House Clerk filings (each row links to its
              filing); the ledger accumulates every pull, so history deepens over time. Last
              successful update: {fmtIso(primary.lastSuccess)}.
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
