import { fundPositioning } from "@/lib/research/fund-positioning";
import { FundAllocation } from "@/components/research/fund-allocation";
import { Note } from "@/components/shell/ui";
import "@/lib/providers/register";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fund Positioning" };

/**
 * What the largest tracked managers reported holding, and what moved.
 *
 * Assembled from 13F-HR information tables on SEC EDGAR — the filings
 * themselves, not a summary of them. Everything here is a quarter old by
 * construction; the page says so rather than presenting it as positioning.
 */
export default async function FundsPage() {
  const { funds, newestPeriod, trackedCount } = await fundPositioning();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-[15px] font-semibold">Fund Positioning</h1>
        <span className="text-[10px] text-[var(--ink-3)]">
          13F-HR filings · {funds.length} of {trackedCount} tracked managers
          {newestPeriod ? ` · newest quarter ${newestPeriod}` : ""}
        </span>
      </div>

      <Note>
        <span>
          A 13F is a <strong>quarterly snapshot filed up to 45 days late</strong>. By the time it
          is public a manager may have reversed the whole position — this is a record of past
          positioning, never of current positioning. It also covers long US equity only: no
          shorts, no bonds, no cash, no foreign listings, so a fund whose risk sits in futures
          will look small and oddly allocated here.
        </span>
      </Note>

      {funds.length === 0 ? (
        <section className="panel p-4">
          <p className="text-[11px] text-[var(--ink-3)]">
            No filings could be read from EDGAR just now. Nothing is cached from a previous pull,
            so there is nothing to show — rather than a stale table presented as current.
          </p>
        </section>
      ) : (
        funds.map((f) => <FundAllocation key={f.cik} fund={f} />)
      )}

      <p className="text-[9px] leading-snug text-[var(--ink-3)]">
        Positions a manager splits across several rows by voting authority are summed into one.
        Exits are recovered from the prior quarter, since something sold to zero does not appear
        in the current table at all. Tickers are resolved from CUSIP where the mapping is known;
        an unmapped issuer is shown by name rather than guessed at.
      </p>
    </div>
  );
}
