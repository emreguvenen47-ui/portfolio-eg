import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writablePath } from "./writable-dir";

/**
 * Regression tests for the bug this file exists to fix — see disk-cache.test.ts
 * for the fuller account. Supabase is mocked to null so these run offline and
 * exercise exactly the path a machine without it takes: local disk.
 */
vi.mock("./supabase", () => ({ getSupabaseAdmin: () => null }));

const { sharedCache } = await import("./shared-cache");

const names: string[] = [];
function uniqueKind(): string {
  const kind = `test-sharedcache-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  names.push(kind);
  return kind;
}

afterEach(() => {
  for (const kind of names.splice(0)) {
    const path = join(writablePath(".cache"), `shared-${kind}.json`);
    if (existsSync(path)) rmSync(path);
  }
});

describe("sharedCache (disk fallback, no Supabase configured)", () => {
  it("returns a fresh value and reports it as not stale", async () => {
    const cache = sharedCache<string>(uniqueKind(), 60_000);
    await cache.ready();
    cache.set("AAPL", "fresh-value");

    expect(cache.get("AAPL")).toBe("fresh-value");
    expect(cache.has("AAPL")).toBe(true);
    expect(cache.isStale("AAPL")).toBe(false);
  });

  it("still returns a value past maxAgeMs instead of hiding it", async () => {
    const cache = sharedCache<string>(uniqueKind(), 1);
    await cache.ready();
    cache.set("AAPL", "old-value");

    const deadline = Date.now() + 5;
    while (Date.now() < deadline) {
      /* spin */
    }

    expect(cache.get("AAPL")).toBe("old-value");
    expect(cache.has("AAPL")).toBe(true);
    expect(cache.isStale("AAPL")).toBe(true);
  });

  it("reports a symbol nothing has ever written as absent, not stale", async () => {
    const cache = sharedCache<string>(uniqueKind(), 60_000);
    await cache.ready();

    expect(cache.get("GHOST")).toBeUndefined();
    expect(cache.has("GHOST")).toBe(false);
    expect(cache.isStale("GHOST")).toBe(false);
  });
});
