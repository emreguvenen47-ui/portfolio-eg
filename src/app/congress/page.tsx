import { Chip, Note, Panel } from "@/components/shell/ui";
import { CONGRESS_BLOCKER, MIN_SAMPLE, dedupe, summarise, withLag } from "@/lib/research/congress";
import { getCongressTrades } from "@/lib/research/alt-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Congress Trading" };

/**
 * Congressional disclosure tracking, as its own section.
 *
 * These are legally required, lagged disclosures — not insider trading, and
 * the page never uses that phrase. Transaction date and disclosure date are
 * always shown apart because the gap between them is the point.
 */
export default async function CongressPage() {
  const raw = await getCongressTrades().catch(() => []);
  const rows = dedupe(raw.map((t) => withLag(t)));
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

          <Panel title="Recent Disclosures" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th className="tl">Member</th>
                    <th className="tl">Chamber</th>
                    <th className="tl">Ticker</th>
                    <th className="tl">Side</th>
                    <th className="tl">Transaction</th>
                    <th className="tl">Disclosed</th>
                    <th>Lag</th>
                    <th className="tl">Reported value</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 60).map((r, i) => (
                    <tr key={i}>
                      <td className="tl">{r.politician}</td>
                      <td className="tl text-[10px] text-[var(--ink-3)]">{r.chamber}</td>
                      <td className="tl font-semibold">{r.ticker}</td>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-[var(--line)] px-3 py-1.5 text-[9.5px] leading-snug text-[var(--ink-3)]">
              Values are disclosed as ranges, never exact figures, so portfolio-level performance
              cannot be derived from them. Member performance statistics require at least{" "}
              {MIN_SAMPLE} valid trades before they are shown at all.
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
