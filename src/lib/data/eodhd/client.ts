import "server-only";

/**
 * Low-level EODHD REST client for the data layer (fundamentals, news,
 * estimates, screener ingest). Market-data quotes/candles go through the
 * provider chain in `lib/providers/eodhd.ts`; this client is for the richer,
 * slower-moving datasets.
 *
 * All calls are server-side. The key never reaches the client bundle and is
 * never logged.
 */

const BASE = "https://eodhd.com/api";

export class EodhdError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True when retrying later may help (429/5xx/network). */
    readonly transient: boolean,
  ) {
    super(message);
    this.name = "EodhdError";
  }
}

function apiKey(): string {
  const k = process.env.EODHD_API_KEY?.trim();
  if (!k) throw new EodhdError("EODHD_API_KEY is not configured", 0, false);
  return k;
}

export function eodhdConfigured(): boolean {
  return Boolean(process.env.EODHD_API_KEY?.trim());
}

export async function eodhdGet<T>(
  path: string,
  params: Record<string, string> = {},
  timeoutMs = 20_000,
): Promise<T> {
  const qs = new URLSearchParams({ ...params, api_token: apiKey(), fmt: "json" });
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}?${qs}`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (e) {
    throw new EodhdError(
      `EODHD network error: ${e instanceof Error ? e.message : "unknown"}`,
      0,
      true,
    );
  }
  if (res.status === 429) throw new EodhdError("EODHD rate limit", 429, true);
  if (res.status >= 500) throw new EodhdError(`EODHD server error ${res.status}`, res.status, true);
  if (res.status === 404) throw new EodhdError("EODHD: not found", 404, false);
  if (res.status === 402 || res.status === 403) {
    throw new EodhdError(`EODHD subscription forbids this endpoint (${res.status})`, res.status, false);
  }
  if (!res.ok) throw new EodhdError(`EODHD HTTP ${res.status}`, res.status, false);
  return (await res.json()) as T;
}

/**
 * EODHD statement values arrive as strings ("96221000000.00") or null.
 * One tolerant parser used by every normalizer, so "N/A"-ish garbage becomes
 * null exactly once, in one place.
 */
export function eodhdNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "NA" || v === "None") return null;
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}
