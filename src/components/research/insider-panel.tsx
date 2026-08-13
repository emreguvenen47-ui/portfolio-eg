import { Chip, Empty } from "@/components/shell/ui";
import { compactUsd } from "./primitives";
import { KIND_LABEL, isDiscretionary, type InsiderReport, type InsiderSignal } from "@/lib/research/insiders";
import { cn } from "@/lib/utils";

const SIGNAL_TONE: Record<InsiderSignal, "pos" | "neg" | "neutral"> = {
  "STRONG BUYING": "pos",
  BUYING: "pos",
  NEUTRAL: "neutral",
  SELLING: "neg",
  "STRONG SELLING": "neg",
};

export function InsiderSignalChip({ report }: { report: InsiderReport | null }) {
  if (!report) return <Chip tone="neutral">N/A</Chip>;
  return <Chip tone={SIGNAL_TONE[report.signal]}>{report.signal}</Chip>;
}

export function InsiderPanel({ report }: { report: InsiderReport | null }) {
  if (!report || report.rows.length === 0) {
    return <Empty>No insider filings available for this symbol.</Empty>;
  }

  return (
    <div>
      {/* --- signal ------------------------------------------------------ */}
      <div className="flex flex-wrap items-baseline gap-2 border-b border-[var(--line)] px-3 py-2">
        <span className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
          Insider Activity Signal
        </span>
        <InsiderSignalChip report={report} />
        <span className="min-w-0 flex-1 text-[10.5px] leading-snug text-[var(--ink-2)]">
          {report.rationale}
        </span>
      </div>

      {/* --- windows ----------------------------------------------------- */}
      <div className="overflow-x-auto border-b border-[var(--line)]">
        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">Window</th>
              <th>Buys</th>
              <th>Sells</th>
              <th>Buyers</th>
              <th>Sellers</th>
              <th>Bought</th>
              <th>Sold</th>
              <th>Net</th>
              <th className="tl">Cluster</th>
            </tr>
          </thead>
          <tbody>
            {report.windows.map((w) => (
              <tr key={w.label}>
                <td className="tl font-semibold">{w.label}</td>
                <td className="tabular-nums">{w.buyCount}</td>
                <td className="tabular-nums">{w.sellCount}</td>
                <td className="tabular-nums">{w.uniqueBuyers}</td>
                <td className="tabular-nums">{w.uniqueSellers}</td>
                <td className="tabular-nums text-emerald-400">
                  {w.buyValue > 0 ? compactUsd(w.buyValue) : "—"}
                </td>
                <td className="tabular-nums text-rose-400">
                  {w.sellValue > 0 ? compactUsd(w.sellValue) : "—"}
                </td>
                <td
                  className={cn(
                    "tabular-nums font-semibold",
                    w.netValue > 0 ? "text-emerald-400" : w.netValue < 0 ? "text-rose-400" : "",
                  )}
                >
                  {w.buyValue || w.sellValue ? compactUsd(w.netValue) : "—"}
                </td>
                <td className="tl">
                  {w.clusterBuying ? (
                    <Chip tone="pos">CLUSTER BUYING</Chip>
                  ) : (
                    <span className="text-[10px] text-[var(--ink-3)]">
                      {w.days <= 90 ? "no" : "n/a"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {report.notableBuys.length > 0 && (
        <div className="border-b border-[var(--line)] px-3 py-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
            Purchases that materially increased the insider&apos;s own holding
          </div>
          <ul className="space-y-0.5">
            {report.notableBuys.map((b, i) => (
              <li key={i} className="text-[10.5px] text-[var(--ink-2)]">
                <span className="text-[var(--ink)]">{b.name}</span> — {compactUsd(b.value)} on{" "}
                {b.date}, lifting their position {b.ownershipChangePct.toFixed(0)}%
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* --- transactions ------------------------------------------------ */}
      <div className="overflow-x-auto">
        <table className="grid-table">
          <thead>
            <tr>
              <th className="tl">Insider</th>
              <th className="tl">Title</th>
              <th className="tl">Date</th>
              <th className="tl">Type</th>
              <th className="tl">Side</th>
              <th>Shares</th>
              <th>Price</th>
              <th>Value</th>
              <th>Held After</th>
              <th>Δ Own.</th>
              <th className="tl">10b5-1</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.slice(0, 40).map((r, i) => {
              const discretionary = isDiscretionary(r.kind);
              return (
                <tr
                  key={`${r.name}-${r.date}-${i}`}
                  // Mechanical filings are dimmed so the eye lands on the
                  // handful of real decisions in a page of RSU plumbing.
                  className={cn(!discretionary && "opacity-55")}
                >
                  <td className="tl max-w-[160px] truncate" title={r.name}>
                    {r.name}
                  </td>
                  <td className="tl text-[var(--ink-3)]">{r.title ?? "N/A"}</td>
                  <td className="tl tabular-nums">{r.date}</td>
                  <td className="tl">
                    <span
                      className={cn(
                        "text-[10px]",
                        discretionary ? "text-[var(--ink)]" : "text-[var(--ink-3)]",
                      )}
                      title={r.code ? `Form 4 code ${r.code}` : "No transaction code filed"}
                    >
                      {KIND_LABEL[r.kind]}
                      {r.code ? ` (${r.code})` : ""}
                    </span>
                  </td>
                  <td className="tl">
                    <span className={r.side === "BUY" ? "text-emerald-400" : "text-rose-400"}>
                      {r.side}
                    </span>
                  </td>
                  <td className="tabular-nums">{r.shares.toLocaleString()}</td>
                  <td className="tabular-nums">{r.price === null ? "N/A" : `$${r.price.toFixed(2)}`}</td>
                  <td className="tabular-nums">{r.value === null ? "N/A" : compactUsd(r.value)}</td>
                  <td className="tabular-nums text-[var(--ink-3)]">
                    {r.sharesAfter === null ? "N/A" : r.sharesAfter.toLocaleString()}
                  </td>
                  <td
                    className={cn(
                      "tabular-nums",
                      (r.ownershipChangePct ?? 0) > 0 ? "text-emerald-400" : "text-rose-400",
                    )}
                  >
                    {r.ownershipChangePct === null
                      ? "N/A"
                      : `${r.ownershipChangePct > 0 ? "+" : ""}${r.ownershipChangePct.toFixed(1)}%`}
                  </td>
                  <td className="tl text-[var(--ink-3)]">N/A</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-[var(--line)] px-3 py-2 text-[9.5px] leading-snug text-[var(--ink-3)]">
        Only <strong>open-market purchases (code P)</strong> and{" "}
        <strong>sales (code S)</strong> count toward the flow totals and the signal. Option
        exercises (M), stock awards (A), shares withheld for tax (F) and gifts (G) are
        mechanical — they are listed but dimmed, and excluded from the summary, because
        treating a vesting event as an insider sale makes almost every large company look
        permanently bearish. {report.mechanicalCount} of {report.rows.length} filings shown
        here are mechanical. Title, direct/indirect ownership and the 10b5-1 flag are not
        carried by this data feed and read N/A rather than being inferred. Not an investment
        recommendation.
      </div>
    </div>
  );
}
