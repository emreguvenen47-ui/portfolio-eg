import "server-only";
import { join } from "node:path";

/**
 * Where this process may write.
 *
 * On a normal host the project directory is writable and caches live beside
 * the code, where they are easy to inspect and delete. On Vercel the
 * deployment is read-only apart from /tmp, so a write there fails silently and
 * the cache never persists at all — which looks like "the scanner keeps
 * forgetting" rather than like a filesystem error.
 *
 * /tmp on a serverless platform is per-instance and disappears when the
 * instance does. That is genuinely worse than disk, and it is why anything
 * that must survive belongs in Supabase rather than here. What lives here is
 * strictly re-derivable: provider budget counters and assembled market data.
 */

const SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

export const isServerless = (): boolean => SERVERLESS;

/** Root for cache files. */
export const writableRoot = (): string =>
  SERVERLESS ? join("/tmp", "portfolio-eg") : join(process.cwd(), "data");

export const writablePath = (...parts: string[]): string => join(writableRoot(), ...parts);
