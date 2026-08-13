import "server-only";

/**
 * In-process rate limiting for the AI routes.
 *
 * These are the only endpoints that cost real money per call, and they are
 * reachable by anyone who can reach the app. A fixed window per client is
 * enough for a single-tenant deployment: it stops a stuck button or a rapid
 * double-submit from spending a hundred calls, which is the realistic failure
 * mode here rather than a determined attacker.
 *
 * State lives on `globalThis` because Next gives route handlers separate
 * module instances.
 */

const KEY = Symbol.for("pcc.rateLimit");
const buckets: Map<string, { count: number; resetAt: number }> = ((
  globalThis as unknown as Record<symbol, Map<string, { count: number; resetAt: number }>>
)[KEY] ??= new Map());

export interface Limit {
  /** Requests allowed per window. */
  max: number;
  windowMs: number;
}

/** AI endpoints: a handful per minute is far above any real human use. */
export const AI_LIMIT: Limit = { max: 6, windowMs: 60_000 };

export interface LimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function checkLimit(clientId: string, route: string, limit: Limit): LimitResult {
  const key = `${route}:${clientId}`;
  const now = Date.now();
  const b = buckets.get(key);

  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + limit.windowMs });
    return { ok: true, remaining: limit.max - 1, retryAfterSec: 0 };
  }

  if (b.count >= limit.max) {
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }

  b.count++;
  return { ok: true, remaining: limit.max - b.count, retryAfterSec: 0 };
}

/** Best-effort client identity. Behind a proxy this is the forwarded address. */
export function clientIdFrom(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0].trim() ||
    h.get("x-real-ip") ||
    "local"
  );
}

/** Reject oversized bodies before they reach the model. */
export const MAX_AI_BODY_BYTES = 16 * 1024;

export async function readJsonCapped(req: Request): Promise<unknown | null> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_AI_BODY_BYTES) return null;
  const text = await req.text().catch(() => "");
  if (text.length > MAX_AI_BODY_BYTES) return null;
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
