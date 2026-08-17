/**
 * Shown while the 13F tables are read.
 *
 * Twelve managers, each a submissions index plus an information table from
 * EDGAR — around twenty seconds on a cold cache, and under a second after.
 * Without this the browser sits on the previous page with no sign anything is
 * happening.
 */
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-3">
      <div className="h-5 w-44 rounded-sm bg-[var(--panel-2)]" />
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="panel flex items-center gap-4 p-3">
          <div className="h-[150px] w-[150px] shrink-0 rounded-full border-[14px] border-[var(--panel-2)]" />
          <div className="flex flex-1 flex-col gap-1.5">
            {Array.from({ length: 6 }, (_, j) => (
              <div key={j} className="flex justify-between">
                <div className="h-2.5 w-24 rounded-sm bg-[var(--panel-2)]" />
                <div className="h-2.5 w-16 rounded-sm bg-[var(--panel-2)]" />
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[10px] text-[var(--ink-3)]">Reading 13F information tables from SEC EDGAR…</p>
    </div>
  );
}
