import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Which track record the Performance page is showing.
 *
 * Plain links with a query parameter rather than client state: the page is
 * server-rendered, so switching portfolios is a navigation and the selection
 * survives a refresh and can be linked to.
 */
const BENCHMARKS = [
  { key: "SPX", label: "S&P 500" },
  { key: "NDX", label: "Nasdaq 100" },
  { key: "XU100", label: "BIST 100" },
];

export function PortfolioSelector({
  saved,
  virtual = [],
  active,
  benchmark = "SPX",
}: {
  saved: { id: string; name: string }[];
  virtual?: { id: string; name: string }[];
  active: string;
  benchmark?: string;
}) {
  // Virtual portfolios are namespaced `v:` in the query so an id collision
  // between the two stores can never route to the wrong portfolio.
  const items = [
    { id: "real", name: "My Real Portfolio", tag: "" },
    ...saved.map((p) => ({ ...p, tag: "AI" })),
    ...virtual.map((p) => ({ id: `v:${p.id}`, name: p.name, tag: "PAPER" })),
  ];

  const href = (id: string, bm: string) => {
    const params = new URLSearchParams();
    if (id !== "real") params.set("portfolio", id);
    if (bm !== "SPX") params.set("benchmark", bm);
    const qs = params.toString();
    return qs ? `/performance?${qs}` : "/performance";
  };

  return (
    <div className="flex flex-col gap-1.5 border-b border-[var(--line)] px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 w-[64px] text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
          Portfolio
        </span>
        {items.map((p) => (
          <Link
            key={p.id}
            href={href(p.id, benchmark)}
            className={cn(
              "rounded-sm border px-2 py-0.5 text-[10.5px] transition-colors",
              active === p.id
                ? "border-[var(--amber)] bg-[rgba(255,160,40,0.12)] text-[var(--amber)]"
                : "border-[var(--line)] text-[var(--ink-3)] hover:border-[var(--ink-3)] hover:text-[var(--ink-2)]",
            )}
          >
            {p.name}
            {p.tag && <span className="ml-1 text-[9px] uppercase opacity-60">{p.tag}</span>}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 w-[64px] text-[9.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
          Benchmark
        </span>
        {BENCHMARKS.map((b) => (
          <Link
            key={b.key}
            href={href(active, b.key)}
            className={cn(
              "rounded-sm border px-2 py-0.5 text-[10.5px] transition-colors",
              benchmark === b.key
                ? "border-[var(--ink-2)] bg-[var(--panel-2)] text-[var(--ink)]"
                : "border-[var(--line)] text-[var(--ink-3)] hover:border-[var(--ink-3)] hover:text-[var(--ink-2)]",
            )}
          >
            {b.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
