/**
 * CONTRACT TESTS — TaskGraph + Scheduler + ResourceLocks
 * (review items 2, 34, 37): dependency-aware concurrent execution.
 */

import { TaskGraph } from "../../src/core/tasks/task-graph.js";
import { Scheduler } from "../../src/core/tasks/scheduler.js";
import { ResourceLockRegistry } from "../../src/core/concurrency/resource-locks.js";

describe("TaskGraph contract", () => {
  it("validates cycles and unknown dependencies (item 2)", () => {
    const g = new TaskGraph();
    g.add({ id: "a", goal: "A", dependencies: ["b"] });
    g.add({ id: "b", goal: "B", dependencies: ["a"] });
    g.add({ id: "c", goal: "C", dependencies: ["missing"] });
    const problems = g.validate();
    expect(problems.some((p) => p.includes("cycle"))).toBe(true);
    expect(problems.some((p) => p.includes("unknown node"))).toBe(true);
  });

  it("ready nodes respect dependencies; completed deps unlock dependents (item 34)", () => {
    const g = new TaskGraph();
    g.add({ id: "1", goal: "first" });
    g.add({ id: "2", goal: "second", dependencies: ["1"] });
    expect(g.readyNodes().map((n) => n.id)).toEqual(["1"]);
    g.transition("1", "ready");
    g.transition("1", "running");
    g.transition("1", "completed");
    expect(g.readyNodes().map((n) => n.id)).toEqual(["2"]);
  });

  it("retry consumes the node's retry budget; exhaustion cascade-skips dependents (item 34)", () => {
    const g = new TaskGraph();
    g.add({ id: "1", goal: "flaky", maxRetries: 1 });
    g.add({ id: "2", goal: "child", dependencies: ["1"] });
    g.transition("1", "ready");
    g.transition("1", "running");
    g.transition("1", "failed");
    expect(g.retry("1")).toBe(true); // attempt 1 <= maxRetries 1
    g.transition("1", "running");
    g.transition("1", "failed");
    expect(g.retry("1")).toBe(false); // attempt 2 > maxRetries
    const skipped = g.cascadeSkip("1");
    expect(skipped.map((n) => n.id)).toEqual(["2"]);
    expect(g.get("2")?.status).toBe("skipped");
  });
});

describe("Scheduler contract (dependency-aware concurrency)", () => {
  it("runs independent nodes in PARALLEL and serializes dependencies (item 34)", async () => {
    const g = new TaskGraph();
    g.add({ id: "a", goal: "A" });
    g.add({ id: "b", goal: "B" });
    g.add({ id: "c", goal: "C", dependencies: ["a", "b"] });
    const scheduler = new Scheduler({ graph: g, maxParallel: 4 });

    const inFlightPeak = { value: 0 };
    let inFlight = 0;
    await scheduler.drain(async (_node) => {
      inFlight += 1;
      inFlightPeak.value = Math.max(inFlightPeak.value, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight -= 1;
      return "success";
    });
    expect(g.summary().completed).toBe(3);
    expect(g.get("c")?.status).toBe("completed");
    // a and b ran concurrently; c only after both
    expect(inFlightPeak.value).toBeGreaterThanOrEqual(2);
  });

  it("resource locks serialize nodes sharing a lock; disjoint resources run in parallel (item 34)", async () => {
    const g = new TaskGraph();
    g.add({ id: "git1", goal: "commit A", resourceLocks: ["git"] });
    g.add({ id: "git2", goal: "commit B", resourceLocks: ["git"] });
    g.add({ id: "web1", goal: "fetch page", resourceLocks: ["browser"] });
    const locks = new ResourceLockRegistry();
    const scheduler = new Scheduler({ graph: g, locks, maxParallel: 4 });

    let gitConcurrent = 0;
    let gitPeak = 0;
    await scheduler.drain(async (node) => {
      if (node.resourceLocks.includes("git")) {
        gitConcurrent += 1;
        gitPeak = Math.max(gitPeak, gitConcurrent);
      }
      await new Promise((r) => setTimeout(r, 25));
      if (node.resourceLocks.includes("git")) gitConcurrent -= 1;
      return "success";
    });
    expect(g.summary().completed).toBe(3);
    expect(gitPeak).toBe(1); // git lock held by one node at a time
  });

  it("exclusive nodes run alone (item 34)", async () => {
    const g = new TaskGraph();
    g.add({ id: "x1", goal: "one" });
    g.add({ id: "x2", goal: "two" });
    g.add({ id: "ex", goal: "migration", exclusive: true });
    const scheduler = new Scheduler({ graph: g, maxParallel: 4 });
    let inFlight = 0;
    let peak = 0;
    let violation = false;
    const active = new Set<string>();
    await scheduler.drain(async (node) => {
      active.add(node.id);
      inFlight = active.size;
      peak = Math.max(peak, inFlight);
      if (node.id === "ex" && active.size > 1) violation = true;
      if (node.id !== "ex" && active.has("ex")) violation = true;
      await new Promise((r) => setTimeout(r, 20));
      active.delete(node.id);
      return "success";
    });
    expect(g.summary().completed).toBe(3);
    expect(violation).toBe(false);
    expect(peak).toBeGreaterThanOrEqual(2); // non-exclusive nodes DID parallelize
  });

  it("priorities: critical nodes are claimed before normal ones (item 34)", async () => {
    const g = new TaskGraph();
    g.add({ id: "n1", goal: "normal 1" });
    g.add({ id: "c1", goal: "critical 1", priority: "critical" });
    const scheduler = new Scheduler({ graph: g, maxParallel: 1 });
    const order: string[] = [];
    await scheduler.drain(async (node) => {
      order.push(node.id);
      return "success";
    });
    expect(order[0]).toBe("c1");
  });

  it("deadline-expired nodes fail fast (item 34)", async () => {
    const g = new TaskGraph();
    g.add({ id: "late", goal: "never in time", deadlineMs: 1 });
    let clock = 1_000;
    const scheduler = new Scheduler({ graph: g, maxParallel: 2, now: () => clock });
    clock += 5_000; // time passes: the node's 1ms deadline is long gone
    await scheduler.drain(async () => "success");
    expect(g.get("late")?.status).toBe("failed");
    expect(g.get("late")?.metadata.deadlineExceeded).toBe(true);
  });

  it("signal cancellation cancels pending nodes (item 34)", async () => {
    const g = new TaskGraph();
    g.add({ id: "1", goal: "one" });
    g.add({ id: "2", goal: "two" });
    const controller = new AbortController();
    const scheduler = new Scheduler({ graph: g, signal: controller.signal });
    controller.abort();
    const claimed = scheduler.claimNext();
    expect(claimed).toBeNull();
    expect(g.get("1")?.status).toBe("cancelled");
    expect(g.get("2")?.status).toBe("cancelled");
  });
});

describe("ResourceLockRegistry contract", () => {
  it("acquires all-or-nothing; releases pump the queue (item 34)", async () => {
    const locks = new ResourceLockRegistry();
    const releaseA = locks.tryAcquire(["git", "db"]);
    expect(releaseA).toBeDefined();
    // contended set queues
    const queued = locks.acquire(["git", "workspace"], { priority: "normal" });
    await new Promise((r) => setTimeout(r, 10));
    expect(locks.queuedWaiters()).toBe(1);
    releaseA!();
    const releaseB = await queued;
    expect(locks.isFree("git")).toBe(false);
    releaseB();
    expect(locks.isFree("git")).toBe(true);
  });

  it("critical priority jumps the queue (item 34)", async () => {
    const locks = new ResourceLockRegistry();
    const release = locks.tryAcquire(["r"])!;
    // waiters release as soon as they are granted, so the queue keeps flowing
    const normal = locks.acquire(["r"], { priority: "normal" }).then((rel) => {
      rel();
      return "normal";
    });
    const critical = locks.acquire(["r"], { priority: "critical" }).then((rel) => {
      rel();
      return "critical";
    });
    await new Promise((r) => setTimeout(r, 10));
    release();
    const first = await Promise.race([normal, critical]);
    expect(first).toBe("critical");
    await Promise.all([normal, critical]);
  });

  it("acquire timeouts reject (deadline bail-out, item 34)", async () => {
    const locks = new ResourceLockRegistry();
    const release = locks.tryAcquire(["r"])!;
    await expect(locks.acquire(["r"], { timeoutMs: 40 })).rejects.toThrow(/timed out/);
    release();
  });
});
