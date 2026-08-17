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
  const managers = funds.filter((f) => f.kind === "manager");
  const corporates = funds.filter((f) => f.kind === "corporate");

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
        <>
          {corporates.length > 0 && (
            <>
              <div className="flex flex-wrap items-baseline gap-2 pt-1">
                <h2 className="text-[12px] font-semibold uppercase tracking-wide">
                  Corporate strategic stakes
                </h2>
                <span className="text-[10px] text-[var(--ink-3)]">
                  operating companies, not funds
                </span>
              </div>
              <p className="text-[9.5px] leading-snug text-[var(--ink-3)]">
                A corporation holding more than $100M in reportable securities files the same form
                a fund does, which is where its strategic equity stakes become public. Read these
                as a handful of deliberate positions rather than as a portfolio: Alphabet&apos;s is{" "}
                {corporates.find((c) => c.manager === "Alphabet")?.topWeight.toFixed(0) ?? "95"}%
                one holding. Private companies appear here when their shares carry a registered
                class — which is why SpaceX is in this table and most private holdings are not.
              </p>
              {corporates.map((f) => (
                <FundAllocation key={f.cik} fund={f} />
              ))}
            </>
          )}

          <div className="flex flex-wrap items-baseline gap-2 pt-2">
            <h2 className="text-[12px] font-semibold uppercase tracking-wide">Money managers</h2>
            <span className="text-[10px] text-[var(--ink-3)]">largest reported book first</span>
          </div>
          {managers.map((f) => (
            <FundAllocation key={f.cik} fund={f} />
          ))}
        </>
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
