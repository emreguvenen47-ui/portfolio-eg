import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { diskCache } from "./disk-cache";
import { writablePath } from "./writable-dir";

/**
 * Regression tests for the bug this file exists to fix.
 *
 * The reported symptom was "opportunities data disappears while the app is
 * open" — an assembled record that crossed `maxAgeMs` used to be deleted on
 * the very read that discovered it was old, so it vanished from the results
 * table rather than just being due for a refresh. These pin the fix: age
 * affects `isStale` only, never `get`/`has`/survival.
 */

const names: string[] = [];
function uniqueName(): string {
  const name = `test-diskcache-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  names.push(name);
  return name;
}

afterEach(() => {
  for (const name of names.splice(0)) {
    const path = join(writablePath(".cache"), `${name}.json`);
    if (existsSync(path)) rmSync(path);
  }
});

describe("diskCache", () => {
  it("returns a value that has not aged past maxAgeMs, and reports it as not stale", () => {
    const cache = diskCache<string>(uniqueName(), 60_000);
    cache.set("AAPL", "fresh-value");

    expect(cache.get("AAPL")).toBe("fresh-value");
    expect(cache.has("AAPL")).toBe(true);
    expect(cache.isStale("AAPL")).toBe(false);
  });

  it("still returns a value past maxAgeMs — it is stale, not gone", () => {
    const cache = diskCache<string>(uniqueName(), 1);
    cache.set("AAPL", "old-value");

    // Guarantee the entry is now past its 1ms age.
    const deadline = Date.now() + 5;
    while (Date.now() < deadline) {
      /* spin */
    }

    expect(cache.get("AAPL")).toBe("old-value");
    expect(cache.has("AAPL")).toBe(true);
    expect(cache.isStale("AAPL")).toBe(true);
  });

  it("reports a missing key as absent, never as stale", () => {
    const cache = diskCache<string>(uniqueName(), 60_000);

    expect(cache.get("GHOST")).toBeUndefined();
    expect(cache.has("GHOST")).toBe(false);
    expect(cache.isStale("GHOST")).toBe(false);
  });

  it("only removes an entry when delete is called explicitly", () => {
    const cache = diskCache<string>(uniqueName(), 1);
    cache.set("AAPL", "value");
    const deadline = Date.now() + 5;
    while (Date.now() < deadline) {
      /* spin */
    }

    // Reading a stale entry twice must not evict it.
    cache.get("AAPL");
    cache.get("AAPL");
    expect(cache.has("AAPL")).toBe(true);

    cache.delete("AAPL");
    expect(cache.has("AAPL")).toBe(false);
    expect(cache.get("AAPL")).toBeUndefined();
  });
});
