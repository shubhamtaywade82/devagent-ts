import { ConcurrencyGate, GateAbortedError, GateSaturatedError } from "../../src/runtime/concurrency-gate.js";

describe("ConcurrencyGate", () => {
  it("grants immediate leases up to maxConcurrent", async () => {
    const gate = new ConcurrencyGate({ maxConcurrent: 2 });
    expect(gate.activeCount).toBe(0);

    const release1 = await gate.acquire();
    expect(gate.activeCount).toBe(1);

    const release2 = await gate.acquire();
    expect(gate.activeCount).toBe(2);

    release1();
    expect(gate.activeCount).toBe(1);

    release2();
    expect(gate.activeCount).toBe(0);
  });

  it("queues and drains requests as leases are released", async () => {
    const gate = new ConcurrencyGate({ maxConcurrent: 1 });
    const release1 = await gate.acquire();

    let secondGranted = false;
    const secondPromise = gate.acquire().then((release) => {
      secondGranted = true;
      return release;
    });

    expect(secondGranted).toBe(false);
    expect(gate.queuedCount).toBe(1);

    release1();
    const release2 = await secondPromise;
    expect(secondGranted).toBe(true);
    expect(gate.queuedCount).toBe(0);
    expect(gate.activeCount).toBe(1);

    release2();
    expect(gate.activeCount).toBe(0);
  });

  it("prioritizes critical queue before normal queue", async () => {
    const gate = new ConcurrencyGate({ maxConcurrent: 1 });
    const releaseInit = await gate.acquire();

    const order: string[] = [];
    const pNormal = gate.run(async () => {
      order.push("normal");
    }, "normal");
    const pCritical = gate.run(async () => {
      order.push("critical");
    }, "critical");

    releaseInit();
    await Promise.all([pNormal, pCritical]);

    expect(order).toEqual(["critical", "normal"]);
  });

  it("throws GateSaturatedError when queue depth is exceeded", async () => {
    const gate = new ConcurrencyGate({ maxConcurrent: 1, maxQueueDepth: 1 });
    const release1 = await gate.acquire();

    void gate.acquire(); // fills queue (depth = 1)
    await expect(gate.acquire()).rejects.toThrow(GateSaturatedError);

    release1();
  });

  it("handles abortion while waiting in queue", async () => {
    const gate = new ConcurrencyGate({ maxConcurrent: 1 });
    const release1 = await gate.acquire();

    const ac = new AbortController();
    const waitPromise = gate.acquire("normal", ac.signal);
    ac.abort();

    await expect(waitPromise).rejects.toThrow(GateAbortedError);
    expect(gate.queuedCount).toBe(0);

    release1();
  });
});
