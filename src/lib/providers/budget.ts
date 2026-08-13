import "server-only";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { writablePath } from "@/lib/server/writable-dir";

/**
 * Hard daily spend cap for credit-metered providers.
 *
 * Twelve Data's free tier is 800 credits/day and a batch quote costs one
 * credit PER SYMBOL, so a dashboard left open overnight drains the whole
 * allowance before its owner wakes up — which is exactly what happened here
 * (1050 calls, 663 credits gone by 07:30).
 *
 * The counter is persisted so a dev-server restart, a redeploy, or a crash
 * cannot silently hand the app a fresh budget. It resets on the UTC day
 * boundary, matching how the provider itself resets.
 */

const STORE = writablePath(".provider-usage.json");

/** Deliberately far below the 800/day allowance: this is a fallback source. */
const DEFAULT_BUDGET = 200;

interface Usage {
  /** UTC yyyy-mm-dd the counts below belong to. */
  day: string;
  spent: Record<string, number>;
}

let memo: Usage | null = null;

const utcDay = (): string => new Date().toISOString().slice(0, 10);

function load(): Usage {
  const today = utcDay();
  if (memo && memo.day === today) return memo;
  try {
    const parsed = JSON.parse(readFileSync(STORE, "utf8")) as Usage;
    memo = parsed.day === today ? parsed : { day: today, spent: {} };
  } catch {
    // Missing or corrupt file simply means "nothing spent today".
    memo = { day: today, spent: {} };
  }
  return memo;
}

function persist(u: Usage): void {
  try {
    mkdirSync(dirname(STORE), { recursive: true });
    writeFileSync(STORE, JSON.stringify(u), "utf8");
  } catch {
    // A read-only filesystem must not break price fetching; the in-memory
    // counter still caps spend for the life of the process.
  }
}

export function budgetFor(provider: string): number {
  const raw = Number(process.env[`${provider.toUpperCase()}_DAILY_BUDGET`]);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_BUDGET;
}

export function spentToday(provider: string): number {
  return load().spent[provider] ?? 0;
}

export function remainingToday(provider: string): number {
  return Math.max(0, budgetFor(provider) - spentToday(provider));
}

/**
 * Reserve `credits` up front. Returns false when the request would breach the
 * cap, in which case the caller must skip the provider entirely — charging
 * after the fact would let one oversized batch blow through the budget.
 */
export function trySpend(provider: string, credits: number): boolean {
  const u = load();
  const spent = u.spent[provider] ?? 0;
  if (spent + credits > budgetFor(provider)) return false;
  u.spent[provider] = spent + credits;
  persist(u);
  return true;
}

/** Hand credits back when a reserved call failed before reaching the provider. */
export function refund(provider: string, credits: number): void {
  const u = load();
  u.spent[provider] = Math.max(0, (u.spent[provider] ?? 0) - credits);
  persist(u);
}
