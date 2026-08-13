import "server-only";
import { finnhubKey } from "@/lib/providers/finnhub";
import { buildCalendar } from "./calendar";
import { TEMPLATES } from "./playbook";

/**
 * Upcoming catalysts for one symbol: its own corporate events plus the macro
 * releases that move its sleeve.
 *
 * Company events come from Finnhub's earnings calendar (free tier). Dividends
 * and investor days are not on that plan, so they are reported as unavailable
 * rather than invented.
 */

export interface Catalyst {
  date: string;
  kind: "earnings" | "dividend" | "macro" | "corporate";
  title: string;
  detail: string;
  source: string;
}

const CACHE_TTL_MS = 6 * 60 * 60_000;
const CACHE_KEY = Symbol.for("pcc.catalysts.cache");
const cache: Map<string, { at: number; value: Catalyst[] }> = ((
  globalThis as unknown as Record<symbol, Map<string, { at: number; value: Catalyst[] }>>
)[CACHE_KEY] ??= new Map());

/** Macro events whose playbook lists this symbol as a relevant position. */
function macroFor(symbol: string): Catalyst[] {
  const today = new Date().toISOString().slice(0, 10);
  return buildCalendar(0, 2)
    .filter((e) => e.date >= today)
    .filter((e) => TEMPLATES[e.kind].relevantPositions.includes(symbol))
    .map((e) => ({
      date: e.date,
      kind: "macro" as const,
      title: e.title,
      detail: `${e.importance} importance for this sleeve`,
      source: e.source,
    }));
}

async function fetchEarnings(symbol: string): Promise<Catalyst[]> {
  const token = finnhubKey();
  if (!token) return [];

  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);

  const res = await fetch(
    `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${encodeURIComponent(symbol)}&token=${token}`,
    { cache: "no-store" },
  );
  if (!res.ok) return [];
  const json = (await res.json()) as {
    earningsCalendar?: {
      date?: string;
      hour?: string;
      quarter?: number;
      year?: number;
      epsEstimate?: number | null;
      revenueEstimate?: number | null;
    }[];
  };

  return (json.earningsCalendar ?? [])
    .filter((e) => e.date)
    .map((e) => ({
      date: e.date!,
      kind: "earnings" as const,
      title: `Q${e.quarter ?? "?"} ${e.year ?? ""} earnings`,
      // Estimates are frequently null on the free tier; say N/A rather than 0.
      detail: [
        e.hour ? `${e.hour}` : null,
        `EPS estimate ${e.epsEstimate ?? "N/A"}`,
        `revenue estimate ${e.revenueEstimate ?? "N/A"}`,
      ]
        .filter(Boolean)
        .join(" · "),
      source: "Finnhub earnings calendar",
    }));
}

export async function getCatalysts(symbol: string): Promise<Catalyst[]> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let earnings: Catalyst[] = [];
  try {
    earnings = await fetchEarnings(symbol);
  } catch {
    // A macro-only timeline is still a timeline.
  }

  const value = [...earnings, ...macroFor(symbol)].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  cache.set(symbol, { at: Date.now(), value });
  return value;
}
