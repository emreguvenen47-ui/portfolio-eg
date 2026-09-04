import { Panel } from "@/components/shell/ui";
import type { ClassifiedNews, NewsCategory } from "@/lib/engines/news-classify";

/**
 * NEWS TAB — newsroom theme: a timeline of company-specific stories only.
 * Relevance-filtered and deduped upstream; zero stories renders an honest
 * empty state, never generic market news.
 */

const CAT_LABEL: Record<NewsCategory, string> = {
  EARNINGS_GUIDANCE: "EARNINGS",
  PRODUCT: "PRODUCT",
  M_A: "M&A",
  REGULATION: "REGULATORY",
  LAWSUIT: "LEGAL",
  MANAGEMENT: "MANAGEMENT",
  CONTRACT_ORDER: "CONTRACT",
  CAPEX: "CAPEX",
  SUPPLY_CHAIN: "SUPPLY",
  MACRO: "MACRO",
  COMPETITOR: "COMPETITOR",
  ANALYST_ACTION: "ANALYST",
  OTHER: "OTHER",
};

export function NewsTab({ news, symbol }: { news: ClassifiedNews[]; symbol: string }) {
  return (
    <div className="flex flex-col gap-3" style={{ ["--tab-accent" as string]: "#60a5fa" }}>
      <Panel
        title={`${symbol} Newsroom`}
        subtitle={`company-specific stories only · relevance-filtered · deduped · EODHD${news.length ? ` · ${news.length} stories` : ""}`}
        bodyClassName="p-0"
      >
        {news.length === 0 ? (
          <div className="p-4 text-[11.5px] text-[var(--ink-3)]">
            No company-specific story is available right now — either nothing relevant was published
            recently, or the news provider is temporarily unreachable (quota/outage). Nothing generic is
            substituted in its place; this stays an honest zero.
          </div>
        ) : (
          <ol className="divide-y divide-[var(--line-soft,var(--line))]">
            {news.map((n) => (
              <li key={n.url} className="relative px-3 py-2.5 pl-6">
                {/* timeline rail */}
                <span
                  className={`absolute left-2.5 top-4 h-2 w-2 rounded-full ${
                    n.sentiment === "POSITIVE"
                      ? "bg-emerald-400"
                      : n.sentiment === "NEGATIVE"
                        ? "bg-rose-400"
                        : "bg-slate-500"
                  }`}
                />
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12.5px] font-medium leading-snug hover:text-[var(--amber)] hover:underline"
                  >
                    {n.title}
                  </a>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9.5px] text-[var(--ink-3)]">
                  <span className="tabular-nums">{n.date.slice(0, 16).replace("T", " ")}</span>
                  {n.source ? <span>· {n.source}</span> : null}
                  <span
                    className="rounded border border-[var(--line)] px-1 py-px uppercase tracking-wider"
                    style={{ color: "#60a5fa" }}
                  >
                    {CAT_LABEL[n.category]}
                  </span>
                  <span
                    className={
                      n.sentiment === "POSITIVE"
                        ? "text-emerald-400"
                        : n.sentiment === "NEGATIVE"
                          ? "text-rose-400"
                          : ""
                    }
                  >
                    {n.sentiment}
                  </span>
                  <span>impact {n.impact}</span>
                  {n.assumptionHint ? <span>· touches: {n.assumptionHint}</span> : null}
                </div>
                {n.summary ? (
                  <p className="mt-1 max-w-[85ch] text-[11px] leading-snug text-[var(--ink-2)]">{n.summary}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
