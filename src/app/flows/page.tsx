import { companyFlow } from "@/lib/research/fund-positioning";
import { FlowTable } from "@/components/research/flow-table";
import { Note } from "@/components/shell/ui";
import "@/lib/providers/register";

export const dynamic = "force-dynamic";
export const metadata = { title: "Company Flow" };

/**
 * Which companies the tracked managers accumulated and unloaded last quarter.
 *
 * Netted across managers by share count, with splits and CUSIP changes folded
 * out — without that the ranking is led by artefacts rather than by decisions.
 */
export default async function FlowsPage() {
  const flow = await companyFlow();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-[15px] font-semibold">Company Flow</h1>
        <span className="text-[10px] text-[var(--ink-3)]">
          {flow.period ? `quarter ending ${flow.period}` : "no filings loaded"} ·{" "}
          {flow.comparable} managers compared
        </span>
      </div>

      <Note>
        <span>
          Netted by <strong>share count</strong>, not by value: a position gains value when the
          price rises without anyone buying a share, and counting that as accumulation would turn
          a rising market into a wave of buying. Only managers who filed{" "}
          <strong>both</strong> of the last two quarters are included — one who has stopped filing
          would otherwise appear to have liquidated everything.
        </span>
      </Note>

      {flow.corporateActions > 0 && (
        <p className="text-[9.5px] leading-snug text-[var(--ink-3)]">
          {flow.corporateActions.toLocaleString()} splits and identifier changes were folded out of
          the comparison. A five-for-one split otherwise reads as a 900% purchase, and a spinoff
          reads as every holder liquidating on the same day.
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <FlowTable
          title="Most accumulated"
          rows={flow.bought}
          side="buy"
          note="Click a row for the managers behind it."
        />
        <FlowTable
          title="Most unloaded"
          rows={flow.sold}
          side="sell"
          note="Click a row for the managers behind it."
        />
      </div>

      {flow.delisted.length > 0 && (
        <FlowTable
          title="Left the market — not shown above"
          rows={flow.delisted}
          side="sell"
          note="Every holder exited and the ticker is no longer listed. That is an acquisition or a delisting rather than a decision to sell, so it is kept out of the ranking — a cash takeover would otherwise sit at the top of a list meant to show what managers chose to do."
        />
      )}

      {flow.skippedStale.length > 0 && (
        <p className="text-[9px] leading-snug text-[var(--ink-3)]">
          Excluded for not filing the latest quarter: {flow.skippedStale.join(", ")}.
        </p>
      )}

      <p className="text-[9px] leading-snug text-[var(--ink-3)]">
        13F filings are quarterly and arrive up to 45 days after the quarter ends, so everything
        here describes positioning that is already at least six weeks old. Corporate filers —
        operating companies reporting strategic stakes — are excluded; they are shown on the Fund
        13F page instead.
      </p>
    </div>
  );
}
