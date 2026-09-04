import Link from "next/link";
import { TickerSearch } from "@/components/shell/ticker-search";

/**
 * COMMAND CENTER — the friendly front of the dashboard: one big search and
 * direct doors to every major desk, so nothing lives only in the sidebar.
 */

const DOORS: Array<{ href: string; title: string; desc: string; accent: string; icon: string }> = [
  { href: "/opportunities", title: "Opportunities", desc: "Ranked ideas over 6,900+ precomputed companies — with why-it's-here", accent: "#f59e0b", icon: "◎" },
  { href: "/screener", title: "Screener", desc: "20+ filters or plain-language queries, instant over the full universe", accent: "#22d3ee", icon: "▤" },
  { href: "/chart/AAPL", title: "Technical Workstation", desc: "TradingView chart, drawings, EG Analyze, paper trades", accent: "#34d399", icon: "▲" },
  { href: "/ticker/GOLD", title: "Macro & Commodities", desc: "Gold, silver, Brent, BTC, ETH — full ticker pages", accent: "#a78bfa", icon: "◈" },
  { href: "/virtual", title: "Paper Trading", desc: "Test ideas with immutable entry snapshots — no real money", accent: "#4ade80", icon: "✎" },
  { href: "/polymarket", title: "Prediction Markets", desc: "Market-implied probabilities across 12 categories", accent: "#818cf8", icon: "%" },
];

export function CommandCenter() {
  return (
    <div className="rounded border border-[var(--line)] p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[16px] font-semibold tracking-tight">
            Good to see you<span className="text-[var(--amber)]">.</span>
          </h1>
          <p className="text-[10.5px] text-[var(--ink-3)]">
            Search any US stock or a macro ticker (GOLD, BTC, BRENT…) — every company page works whether you hold it or not.
          </p>
        </div>
        <div className="ml-auto w-full sm:w-[320px]">
          <TickerSearch />
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {DOORS.map((d) => (
          <Link
            key={d.href}
            href={d.href}
            className="group rounded border border-[var(--line)] p-2.5 transition-colors hover:bg-white/5"
            style={{ borderLeft: `2px solid ${d.accent}` }}
          >
            <div className="flex items-center gap-1.5">
              <span style={{ color: d.accent }}>{d.icon}</span>
              <span className="text-[11.5px] font-semibold group-hover:underline">{d.title}</span>
            </div>
            <p className="mt-1 text-[9.5px] leading-snug text-[var(--ink-3)]">{d.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
