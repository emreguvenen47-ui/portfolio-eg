import Link from "next/link";

/**
 * What a visitor sees before signing in.
 *
 * The research half of this app needs no account — it reads public market data
 * and public filings — so the landing page sends people straight into it
 * rather than putting a login in front of everything. The account is only for
 * the half that is yours: holdings, alerts, paper trades, saved screens.
 */

const OPEN = [
  {
    href: "/opportunities",
    title: "Opportunity Scanner",
    body: "Rank companies against their own sector across the full US listing. Hard filters on size, sector and liquidity are applied before anything is scored.",
  },
  {
    href: "/screener",
    title: "Custom Screener",
    body: "About fifty-five metrics, with thresholds set in absolute terms or relative to a sector or industry median. A company with no value for a metric fails that test rather than slipping through.",
  },
  {
    href: "/rotation",
    title: "Sector Flows",
    body: "Eleven sectors and ten sub-sectors against the benchmark across six windows, with breadth from the constituents. A rotation signal derived from price — not a fund-flow measurement.",
  },
  {
    href: "/markets",
    title: "Markets",
    body: "Indices, rates, commodities and currencies, with the last real print and the time it was taken.",
  },
];

const PRIVATE = [
  "Portfolio analytics, risk decomposition and performance attribution",
  "Alerts on price, technical and exposure conditions",
  "Paper trading with a lot-level ledger",
  "Saved screens and AI-assisted portfolio drafts",
];

export function Landing() {
  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-5 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-[22px] font-semibold leading-tight">
          PORTFOLIO<span className="text-[var(--amber)]"> EG</span>
        </h1>
        <p className="max-w-[62ch] text-[12px] leading-relaxed text-[var(--ink-2)]">
          An investment research terminal. A scanner over the full US listing, a custom screener,
          sector rotation, and company research assembled from public filings.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href="/opportunities"
            className="rounded-sm border border-[var(--amber)] bg-[rgba(255,160,40,0.12)] px-3 py-1.5 text-[11px] font-medium text-[var(--amber)]"
          >
            OPEN THE SCANNER →
          </Link>
          <Link
            href="/login"
            className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-[11px] text-[var(--ink-2)]"
          >
            SIGN IN
          </Link>
          <Link
            href="/signup"
            className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-[11px] text-[var(--ink-2)]"
          >
            CREATE ACCOUNT
          </Link>
        </div>
      </header>

      <section className="panel">
        <div className="border-b border-[var(--line)] px-3 py-1.5 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
          Open to everyone — no account
        </div>
        <div className="grid gap-px bg-[var(--line)] sm:grid-cols-2">
          {OPEN.map((x) => (
            <Link
              key={x.href}
              href={x.href}
              className="flex flex-col gap-1 bg-[var(--panel)] p-3 hover:bg-[var(--panel-2)]"
            >
              <span className="text-[12px] font-semibold text-[var(--amber)]">{x.title}</span>
              <span className="text-[10.5px] leading-snug text-[var(--ink-3)]">{x.body}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="border-b border-[var(--line)] px-3 py-1.5 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
          With an account
        </div>
        <ul className="flex flex-col gap-1 px-3 py-2">
          {PRIVATE.map((x) => (
            <li key={x} className="text-[10.5px] text-[var(--ink-2)]">
              · {x}
            </li>
          ))}
        </ul>
        <p className="border-t border-[var(--line)] px-3 py-2 text-[9.5px] leading-snug text-[var(--ink-3)]">
          Each account sees only its own. Isolation is enforced by row-level policies in the
          database rather than by application code, so a missing filter returns nothing rather than
          somebody else&apos;s holdings.
        </p>
      </section>

      <section className="panel">
        <div className="border-b border-[var(--line)] px-3 py-1.5 text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
          How it treats missing data
        </div>
        <p className="px-3 py-2 text-[10.5px] leading-relaxed text-[var(--ink-2)]">
          You will see <span className="text-[var(--ink-3)]">N/A</span> here more than in a
          commercial terminal, on purpose. A screener that admits a company because its EV/EBITDA
          is unknown looks identical to one that worked. Where a number could not be sourced, this
          says so — and scores carry the coverage they were computed from, so a company with thin
          data is never ranked as though it were complete.
        </p>
      </section>

      <p className="text-[9.5px] leading-snug text-[var(--ink-3)]">
        A research tool, not investment advice. Fair value is a model-implied range, not a price
        target. Congressional and 13F figures are delayed public filings. Nothing here places an
        order, and paper trading is exactly that.
      </p>
    </div>
  );
}
