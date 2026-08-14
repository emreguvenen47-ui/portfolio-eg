/**
 * Shown while a ticker page is being assembled.
 *
 * A company nobody has looked at costs several rate-limited provider calls,
 * and without this the browser sat on the previous page for seconds with no
 * sign anything had happened — which reads as a broken click rather than as
 * work in progress. The route streams, so this appears immediately and is
 * replaced piece by piece.
 */
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <div className="h-5 w-28 rounded-sm bg-[var(--panel-2)]" />
        <div className="h-3 w-44 rounded-sm bg-[var(--panel-2)]" />
      </div>

      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <div className="panel h-[260px]" />
        <div className="panel flex flex-col gap-2 p-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex justify-between">
              <div className="h-2.5 w-20 rounded-sm bg-[var(--panel-2)]" />
              <div className="h-2.5 w-14 rounded-sm bg-[var(--panel-2)]" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="panel h-[150px]" />
        ))}
      </div>

      <p className="text-[10px] text-[var(--ink-3)]">
        Assembling filings and market data for this company…
      </p>
    </div>
  );
}
