import Link from "next/link";
import type { Portfolio } from "@/lib/types";
import { isSamplePortfolio } from "@/lib/portfolio/starter";
import { isPaperPortfolio } from "@/lib/portfolio/from-paper";

/**
 * Says plainly when the numbers on the page are computed from a sample.
 *
 * Rendered on every page that reads holdings. The market data underneath is
 * real, which is exactly why this has to be visible: a page of genuine prices
 * and genuine risk figures over an invented allocation is the easiest thing in
 * this app to mistake for your own position.
 */
export function SampleBanner({ portfolio }: { portfolio: Portfolio }) {
  const sample = isSamplePortfolio(portfolio);
  const paper = isPaperPortfolio(portfolio);
  if (!sample && !paper) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-[var(--amber)] bg-[rgba(255,160,40,0.08)] px-3 py-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--amber)]">
        {sample ? "Sample portfolio" : "Paper portfolio"}
      </span>
      <span className="text-[10.5px] leading-snug text-[var(--ink-2)]">
        {sample
          ? "These are not your holdings. Prices, returns and risk are real; the allocation is a worked example so the analytics have something to run on."
          : `Built from your paper-trading ledger — ${portfolio.meta.title}. Prices, returns and risk are real; the positions are simulated trades, not a brokerage statement.`}
      </span>
      <span className="ml-auto flex items-center gap-2">
        <Link
          href="/settings"
          className="whitespace-nowrap text-[10px] text-[var(--ink-3)] hover:text-[var(--amber)]"
        >
          upload a workbook
        </Link>
        <Link
          href="/virtual"
          className="whitespace-nowrap rounded-sm border border-[var(--amber)] px-2 py-0.5 text-[10px] text-[var(--amber)]"
        >
          {sample ? "BUILD YOURS →" : "OPEN LEDGER →"}
        </Link>
      </span>
    </div>
  );
}
