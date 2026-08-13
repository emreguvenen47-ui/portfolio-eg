import { cn } from "@/lib/utils";
import type { ConfidenceReport } from "@/lib/research/confidence";

const TONE = {
  HIGH: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  MEDIUM: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  LOW: "border-rose-500/40 bg-rose-500/10 text-rose-400",
} as const;

/**
 * Provenance grade for a research panel. Says how much the *source* can be
 * trusted, not whether the conclusion is right.
 */
export function ConfidenceBadge({
  report,
  source,
}: {
  report: ConfidenceReport;
  /** Where the data came from, shown alongside the grade. */
  source?: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={cn("chip", TONE[report.level])}
        title={`Data confidence: ${report.why}.`}
      >
        {report.level}
      </span>
      {source && <span className="text-[9px] text-[var(--ink-3)]">{source}</span>}
      {report.asOf && (
        <span className="text-[9px] text-[var(--ink-3)]">
          as of {report.asOf.slice(0, 10)}
        </span>
      )}
      {report.isDelayed && (
        <span className="text-[9px] text-amber-400/80">delayed</span>
      )}
    </span>
  );
}
