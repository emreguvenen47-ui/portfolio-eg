export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-3">
      <div className="h-5 w-40 rounded-sm bg-[var(--panel-2)]" />
      <div className="grid gap-3 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="panel flex flex-col gap-1.5 p-3">
            {Array.from({ length: 12 }, (_, j) => (
              <div key={j} className="flex justify-between">
                <div className="h-2.5 w-16 rounded-sm bg-[var(--panel-2)]" />
                <div className="h-2.5 w-20 rounded-sm bg-[var(--panel-2)]" />
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-[var(--ink-3)]">Comparing two quarters of 13F filings…</p>
    </div>
  );
}
