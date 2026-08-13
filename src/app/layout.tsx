import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { MobileNav, SideNav } from "@/components/shell/nav";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HeaderStatus } from "@/components/shell/header-status";
import { TickerSearch } from "@/components/shell/ticker-search";
import { SessionBadge } from "@/components/auth/session-badge";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "PORTFOLIO EG", template: "%s · PORTFOLIO EG" },
  description: "Private multi-asset research and portfolio terminal. Analytics only — no execution.",
  applicationName: "PORTFOLIO EG",
  /**
   * Indexable by default: the landing page and the research half are public.
   * Account pages are kept out of an index by the middleware redirect, which
   * a crawler cannot get past, and are listed in robots.ts as well.
   */
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <TooltipProvider delay={200}>
          <div className="flex min-h-screen flex-col">
            <header className="sticky top-0 z-30 flex h-11 items-center gap-3 border-b border-[var(--line)] bg-[var(--panel)] px-3">
              <Link href="/" className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-sm bg-[var(--amber)] text-[10px] font-black text-[#100d06]">
                  EG
                </span>
                <span className="text-[13px] font-semibold tracking-tight">
                  PORTFOLIO<span className="text-[var(--amber)]"> EG</span>
                </span>
              </Link>
              <span className="hidden text-[10px] uppercase tracking-[0.14em] text-[var(--ink-3)] sm:block">
                Private Research Terminal
              </span>
              <div className="ml-auto flex items-center gap-2">
                <TickerSearch />
                <HeaderStatus />
                <SessionBadge />
              </div>
            </header>

            <MobileNav />

            <div className="flex flex-1">
              <aside className="sticky top-11 hidden h-[calc(100vh-2.75rem)] w-[168px] shrink-0 overflow-y-auto border-r border-[var(--line)] bg-[var(--panel)] lg:block">
                <SideNav />
                <div className="mt-2 border-t border-[var(--line)] px-3 py-2 text-[9.5px] leading-relaxed text-[var(--ink-3)]">
                  Research, analytics and educational information — not investment advice.
                  Never places trades and has no brokerage connectivity. Prediction-market
                  numbers are market-implied probabilities, not forecasts. Congressional and
                  13F data are delayed public filings. Fair value is a model-implied range,
                  not a price target.
                </div>
              </aside>
              <main className="min-w-0 flex-1 p-3">{children}</main>
            </div>
          </div>
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </body>
    </html>
  );
}
