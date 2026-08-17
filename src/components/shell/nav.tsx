"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  Activity,
  Briefcase,
  GitCompare,
  History,
  Workflow,
  BarChart3,
  CalendarClock,
  Coins,
  Eye,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  LineChart,
  ListTree,
  Filter,
  Landmark,
  Newspaper,
  Percent,
  Radar,
  ScanSearch,
  Settings,
  Shuffle,
  SlidersHorizontal,
  Wallet,
  Sparkles,
  Target,
  PieChart,
  ArrowLeftRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Primary areas first, then the tools that hang off them. Grouped rather than
 * a flat list of twenty-five links — the sidebar had grown past the point
 * where anything could be found in it.
 */
const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/committee", label: "Committee", icon: Briefcase },
  { href: "/ai-builder", label: "AI Builder", icon: Sparkles },
  { href: "/news", label: "News", icon: Newspaper },
  { href: "/virtual", label: "Paper Trading", icon: Wallet },
  { href: "/markets", label: "Markets", icon: Activity },
  { href: "/opportunities", label: "Opportunities", icon: Radar },
  { href: "/screener", label: "Custom Screener", icon: Filter },
  { href: "/rotation", label: "Sector Flows", icon: Shuffle },
  { href: "/funds", label: "Fund 13F", icon: PieChart },
  { href: "/flows", label: "Company Flow", icon: ArrowLeftRight },
  { href: "/compare", label: "Compare", icon: GitCompare },
  { href: "/positions", label: "Positions", icon: ListTree },
  { href: "/risk", label: "Risk", icon: Gauge },
  { href: "/xray", label: "X-Ray", icon: ScanSearch },
  { href: "/stress", label: "Stress Test", icon: FlaskConical },
  { href: "/what-if", label: "What-If", icon: SlidersHorizontal },
  { href: "/crisis", label: "Crisis Sim", icon: History },
  { href: "/chains", label: "Event Chains", icon: Workflow },
  { href: "/rebalance", label: "Rebalance", icon: Target },
  { href: "/theses", label: "Theses", icon: BarChart3 },
  { href: "/performance", label: "Performance", icon: LineChart },
  { href: "/currencies", label: "Currencies", icon: Coins },
  { href: "/watchlist", label: "Watchlist", icon: Eye },
  { href: "/events", label: "Events", icon: CalendarClock },
  { href: "/polymarket", label: "Polymarket", icon: Percent },
  { href: "/congress", label: "Congress", icon: Landmark },
  { href: "/alerts", label: "Alerts", icon: AlertTriangle },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 p-2">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "group flex items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] transition-colors",
              active
                ? "bg-[rgba(255,160,40,0.12)] text-[var(--amber)]"
                : "text-[var(--ink-2)] hover:bg-[var(--panel-2)] hover:text-[var(--ink)]",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            <span className="truncate">{label}</span>
            {active && <span className="ml-auto h-3 w-[2px] rounded bg-[var(--amber)]" />}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 lg:hidden">
      {NAV.map(({ href, label }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "whitespace-nowrap rounded-sm px-2 py-1 text-[11px]",
              active ? "bg-[rgba(255,160,40,0.12)] text-[var(--amber)]" : "text-[var(--ink-2)]",
            )}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
