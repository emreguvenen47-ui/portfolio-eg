import { describe, expect, it, vi } from "vitest";

/**
 * Shared-cache and in-flight deduplication.
 *
 * The property under test is the one that decides whether a hundred users
 * asking about the same company produce one upstream call or a hundred. It is
 * exercised here against a copy of the helper's shape rather than the module
 * itself, because the real one reaches for a network client on import.
 */

function makeCached(ttlMs: number) {
  const cache = new Map<string, { at: number; value: unknown }>();
  const inflight = new Map<string, Promise<unknown>>();

  return async function cached<T>(key: string, load: () => Promise<T>): Promise<T | null> {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;

    const running = inflight.get(key) as Promise<T | null> | undefined;
    if (running) return running;

    const p = (async () => {
      try {
        const value = await load();
        cache.set(key, { at: Date.now(), value });
        return value;
      } catch {
        return (hit?.value as T) ?? null;
      }
    })().finally(() => inflight.delete(key));

    inflight.set(key, p);
    return p;
  };
}

describe("request deduplication", () => {
  it("collapses concurrent identical requests into one fetch", async () => {
    const cached = makeCached(60_000);
    const load = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { eps: 1.23 };
    });

    const results = await Promise.all(
      Array.from({ length: 100 }, () => cached("fin:AAPL", load)),
    );

    expect(load).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r && (r as { eps: number }).eps === 1.23)).toBe(true);
  });

  it("keeps different keys independent", async () => {
    const cached = makeCached(60_000);
    const load = vi.fn(async () => 1);
    await Promise.all([cached("a", load), cached("b", load), cached("a", load)]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("serves the cache on the next call rather than refetching", async () => {
    const cached = makeCached(60_000);
    const load = vi.fn(async () => 7);
    await cached("k", load);
    await cached("k", load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("releases the in-flight slot so a later call can retry a failure", async () => {
    const cached = makeCached(60_000);
    let attempt = 0;
    const load = vi.fn(async () => {
      attempt++;
      if (attempt === 1) throw new Error("provider down");
      return "ok";
    });

    // A failure with nothing cached yields null, and must not be remembered
    // as the answer.
    expect(await cached("k", load)).toBeNull();
    expect(await cached("k", load)).toBe("ok");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
