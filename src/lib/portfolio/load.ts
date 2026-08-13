import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Portfolio } from "@/lib/types";
import { parsePortfolioWorkbook } from "./excel";
import { loadingsFor } from "./config";

/**
 * Loads the workbook that seeds the app. Parsed once per server process.
 *
 * Nothing about the holdings is hardcoded — change the spreadsheet and the
 * whole app follows.
 */

const DEFAULT_FILE = process.env.PORTFOLIO_FILE ?? "data/Portfoy_Tahsisi.xlsx";

let cached: Portfolio | null = null;
let cachedError: string | null = null;

export async function loadPortfolio(): Promise<Portfolio> {
  if (cached) return cached;
  if (cachedError) throw new Error(cachedError);

  const abs = path.isAbsolute(DEFAULT_FILE)
    ? DEFAULT_FILE
    : path.join(process.cwd(), DEFAULT_FILE);

  try {
    const buf = await readFile(abs);
    const { portfolio } = parsePortfolioWorkbook(
      new Uint8Array(buf),
      path.basename(abs),
    );
    cached = portfolio;
    return portfolio;
  } catch (err) {
    /**
     * A missing file and a broken file are different problems and deserve
     * different messages. On a fresh install there is simply no workbook yet,
     * which is the expected state rather than a fault — say what to do about
     * it, and do not print an absolute path from whichever machine built this.
     */
    const missing = (err as NodeJS.ErrnoException)?.code === "ENOENT";
    cachedError = missing
      ? `No portfolio loaded yet. Upload an .xlsx on the Settings page, or set ` +
        `PORTFOLIO_FILE to point at one. Everything that does not depend on ` +
        `your holdings — the scanner, screener, sector flows and research ` +
        `pages — works without it.`
      : `Could not read the portfolio workbook (${path.basename(abs)}): ${
          err instanceof Error ? err.message : String(err)
        }`;
    throw new Error(cachedError);
  }
}

/** Replaces the in-process portfolio after a successful upload. */
export function setPortfolio(p: Portfolio): void {
  cached = p;
  cachedError = null;
}

export function peekPortfolio(): Portfolio | null {
  return cached;
}
