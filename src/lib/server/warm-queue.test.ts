import { beforeEach, describe, expect, it, vi } from "vitest";
import { enqueue, queueDepth, queueStats, resetQueue } from "./warm-queue";

/**
 * Performance regression tests.
 *
 * These exist because the failure they guard against is invisible: a queue
 * that quietly fetches something nobody asked for, or that runs the same
 * symbol twice, costs a provider allowance and shows up as "slow" rather than
 * as a bug.
 */

const settle = () => new Promise<void>((r) => setTimeout(r, 30));

beforeEach(() => {
  resetQueue();
});

describe("warm queue", () => {
  it("only ever runs what was enqueued", async () => {
    const ran: string[] = [];
    enqueue(
      ["ACME", "BETA"].map((symbol) => ({
        kind: "t",
        symbol,
        priority: 1,
        run: async () => {
          ran.push(symbol);
        },
      })),
    );
    await settle();
    // No opinion of its own about what is worth fetching.
    expect(ran.sort()).toEqual(["ACME", "BETA"]);
  });

  it("does not queue the same symbol twice", async () => {
    const run = vi.fn(async () => {});
    const task = { kind: "t", symbol: "ACME", priority: 1, run };
    const first = enqueue([task]);
    const second = enqueue([task, task]);
    await settle();
    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps namespaces apart", async () => {
    const ran: string[] = [];
    enqueue([
      { kind: "scanner", symbol: "ACME", priority: 1, run: async () => void ran.push("s") },
      { kind: "screener", symbol: "ACME", priority: 1, run: async () => void ran.push("c") },
    ]);
    await settle();
    // Same ticker, different work: both must run.
    expect(ran.sort()).toEqual(["c", "s"]);
  });

  it("runs the most liquid first", async () => {
    const order: string[] = [];
    enqueue(
      [
        { symbol: "SMALL", priority: 1 },
        { symbol: "HUGE", priority: 1_000 },
        { symbol: "MID", priority: 50 },
      ].map((x) => ({
        kind: "t",
        symbol: x.symbol,
        priority: x.priority,
        run: async () => {
          order.push(x.symbol);
        },
      })),
    );
    await settle();
    expect(order[0]).toBe("HUGE");
  });

  it("survives a failing task and keeps going", async () => {
    const ran: string[] = [];
    enqueue([
      {
        kind: "t",
        symbol: "BAD",
        priority: 10,
        run: async () => {
          throw new Error("provider down");
        },
      },
      { kind: "t", symbol: "GOOD", priority: 1, run: async () => void ran.push("GOOD") },
    ]);
    await settle();
    expect(ran).toEqual(["GOOD"]);
    expect(queueStats().failed).toBe(1);
    expect(queueStats().completed).toBe(1);
  });

  it("reports depth per namespace so the UI can say how many are coming", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    enqueue([{ kind: "scanner", symbol: "ACME", priority: 1, run: () => gate }]);
    expect(queueDepth("scanner")).toBe(1);
    expect(queueDepth("screener")).toBe(0);
    release();
    await settle();
    expect(queueDepth("scanner")).toBe(0);
  });

  it("drains to empty", async () => {
    enqueue(
      Array.from({ length: 25 }, (_, i) => ({
        kind: "t",
        symbol: `S${i}`,
        priority: i,
        run: async () => {},
      })),
    );
    await new Promise<void>((r) => setTimeout(r, 200));
    expect(queueDepth()).toBe(0);
    expect(queueStats().completed).toBe(25);
  });
});
