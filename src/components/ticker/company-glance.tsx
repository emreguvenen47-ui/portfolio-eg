import { Panel } from "@/components/shell/ui";
import type { CompanySnapshot } from "@/lib/data/normalize/company";

/**
 * COMPANY AT A GLANCE — read this and know what the company does in five
 * seconds. GICS classification (precise, not the coarse sector/industry
 * pair), the business model condensed to one line, key facts, and business
 * segments — all extracted deterministically from EODHD's General block and
 * its own filed description. No summarization by a model: the one-liner is
 * literally the description's first sentence, and segments are parsed from
 * its own "operates through X and Y segments" phrasing when present.
 */

/** First sentence of a filed description — the company's own words, trimmed. */
function firstSentence(desc: string): string {
  const m = /^(.*?[.!?])\s/.exec(desc + " ");
  return (m ? m[1] : desc).trim();
}

/** "It operates through Compute & Networking, and Graphics segments." → [...]. */
function extractSegments(desc: string): string[] {
  const m = /operates?\s+(?:its\s+business\s+)?(?:through|in)\s+([^.]+?)\s+segments?\b/i.exec(desc);
  if (!m) return [];
  return m[1]!
    .split(/,|\band\b/i)
    .map((s) => s.replace(/^\s*the\s+/i, "").trim())
    .filter((s) => s.length > 1 && s.length < 60);
}

/** "in the United States, Taiwan, China, ... and internationally" → country list. */
function extractGeographies(desc: string): string[] {
  const m = /\bin\s+((?:the\s+)?[A-Z][\w .]+(?:,\s*[A-Z][\w .]+)*),?\s+and\s+internationally/.exec(desc);
  if (!m) return [];
  return m[1]!
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[A-Z]/.test(s) && s.length < 30)
    .slice(0, 6);
}

export function CompanyGlance({ snapshot }: { snapshot: CompanySnapshot }) {
  const id = snapshot.identity;
  const it = snapshot.intel;
  const desc = id.description ?? "";
  const oneLiner = desc ? firstSentence(desc) : null;
  const segments = desc ? extractSegments(desc) : [];
  const geos = desc ? extractGeographies(desc) : [];
  const gicPath = [it.gicSector, it.gicGroup, it.gicIndustry, it.gicSubIndustry].filter(
    (x, i, arr) => x && arr.indexOf(x) === i, // GICS often repeats group==industry — collapse dupes
  );

  const facts: Array<[string, string | null]> = [
    ["Headquarters", it.hq],
    ["Founded / IPO", it.ipoDate],
    ["Employees", id.employees !== null ? id.employees.toLocaleString() : null],
    ["Fiscal year end", it.fiscalYearEnd],
    ["Exchange", id.exchange],
  ];

  if (!desc && gicPath.length === 0) return null;

  return (
    <Panel bodyClassName="p-0">
      <div className="flex flex-wrap items-start gap-3 p-3">
        {it.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={it.logoUrl}
            alt=""
            className="h-10 w-10 shrink-0 rounded bg-white/90 object-contain p-1"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        <div className="min-w-0 flex-1">
          {/* GICS breadcrumb — the precise classification, not just "Technology" */}
          {gicPath.length > 0 && (
            <div className="mb-1 flex flex-wrap items-center gap-1 text-[9.5px] text-[var(--ink-3)]">
              {gicPath.map((g, i) => (
                <span key={g} className="flex items-center gap-1">
                  {i > 0 && <span className="opacity-50">›</span>}
                  <span className={i === gicPath.length - 1 ? "font-medium text-[var(--amber)]" : ""}>{g}</span>
                </span>
              ))}
            </div>
          )}
          {oneLiner && <p className="text-[12px] font-medium leading-snug text-[var(--ink-1,inherit)]">{oneLiner}</p>}
          {(segments.length > 0 || geos.length > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {segments.map((s) => (
                <span key={s} className="rounded border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] text-cyan-300">
                  {s}
                </span>
              ))}
              {geos.length > 0 && (
                <span className="text-[9px] text-[var(--ink-3)]">
                  · operates in {geos.slice(0, 4).join(", ")}
                  {geos.length > 4 ? " + more" : ""}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-t border-[var(--line)] sm:grid-cols-5">
        {facts.map(([k, v]) => (
          <div key={k} className="px-3 py-1.5">
            <div className="text-[8.5px] uppercase tracking-wider text-[var(--ink-3)]">{k}</div>
            <div className="text-[10.5px] font-medium">{v ?? "N/A"}</div>
          </div>
        ))}
      </div>

      {desc && desc.length > oneLiner!.length + 5 && (
        <details className="border-t border-[var(--line)] px-3 py-1.5">
          <summary className="cursor-pointer text-[9.5px] uppercase tracking-wider text-[var(--ink-3)] hover:text-[var(--amber)]">
            Full business description
          </summary>
          <p className="mt-1.5 max-w-[100ch] text-[11px] leading-relaxed text-[var(--ink-2)]">{desc}</p>
        </details>
      )}
    </Panel>
  );
}
