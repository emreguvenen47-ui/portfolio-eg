import type { Quote } from "@/lib/types";
import { StatusBadge } from "./ui";
import { fmtNum } from "@/lib/format";

/**
 * Price with its provenance: value, source, status, and the venue timestamp.
 *
 *     $625.42 · Finnhub · LIVE · Price 14:31:48
 *
 * The timestamp shown is the provider's MARKET time, not when we fetched it.
 * Those differ overnight by hours, and the market time is the one that says
 * whether the number is current.
 */
export function QuoteLine({
  quote,
  decimals = 2,
  currency = "$",
}: {
  quote: Quote | null | undefined;
  decimals?: number;
  currency?: string;
}) {
  if (!quote) {
    return (
      <span className="flex items-center gap-1.5 text-[10px] text-[var(--ink-3)]">
        <span className="tabular-nums">—</span>
        <StatusBadge status="UNAVAILABLE" reason="No provider returned a real quote" />
      </span>
    );
  }

  const marketTime = new Date(quote.timestamp);
  const stamp = Number.isNaN(marketTime.getTime())
    ? null
    : marketTime.toLocaleTimeString("en-GB", { timeZone: "UTC" });

  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--ink-3)]">
      <span className="text-[11px] font-semibold tabular-nums text-[var(--ink)]">
        {currency}
        {fmtNum(quote.price, decimals)}
      </span>
      <span>·</span>
      <span className="capitalize">{quote.provider}</span>
      <span>·</span>
      <StatusBadge status={quote.status} reason={quote.fallbackReason} />
      {stamp && (
        <>
          <span>·</span>
          <span className="tabular-nums" title={`Fetched ${quote.fetchedAt}`}>
            Price {stamp} UTC
          </span>
        </>
      )}
    </span>
  );
}
