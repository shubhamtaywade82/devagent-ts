import { UsageManager } from "../../src/provider/usage-manager.js";

describe("UsageManager", () => {
  it("is not cooling down before any rate limit is recorded", () => {
    const usage = new UsageManager();
    expect(usage.isCloudCoolingDown(0)).toBe(false);
  });

  it("enters a cooldown window after a rate-limit hit", () => {
    const usage = new UsageManager({ initialCooldownMs: 1000 });
    usage.recordCloudRateLimited(0);
    expect(usage.isCloudCoolingDown(500)).toBe(true);
    expect(usage.isCloudCoolingDown(1000)).toBe(false);
  });

  it("clears the cooldown on the next cloud success", () => {
    const usage = new UsageManager({ initialCooldownMs: 1000 });
    usage.recordCloudRateLimited(0);
    expect(usage.isCloudCoolingDown(500)).toBe(true);
    usage.recordCloudSuccess(500);
    expect(usage.isCloudCoolingDown(500)).toBe(false);
  });

  it("doubles the cooldown on repeated hits within an active window, capped at maxCooldownMs", () => {
    const usage = new UsageManager({ initialCooldownMs: 1000, maxCooldownMs: 3000 });
    usage.recordCloudRateLimited(0); // cooldown until 1000
    usage.recordCloudRateLimited(500); // still cooling down -> next is 2000, until 2500
    expect(usage.isCloudCoolingDown(2000)).toBe(true);
    expect(usage.isCloudCoolingDown(2500)).toBe(false);

    usage.recordCloudRateLimited(2500); // next would be 4000, capped at 3000
    expect(usage.isCloudCoolingDown(2500 + 2999)).toBe(true);
    expect(usage.isCloudCoolingDown(2500 + 3000)).toBe(false);
  });

  it("resets backoff after a success even though weekly history is untouched", () => {
    const usage = new UsageManager({ initialCooldownMs: 1000, weeklyConserveThreshold: 100 });
    usage.recordCloudRateLimited(0);
    usage.recordCloudRateLimited(500); // backoff now 2000ms
    usage.recordCloudSuccess(600);
    usage.recordCloudRateLimited(600); // should use the reset initial cooldown, not the doubled one
    expect(usage.isCloudCoolingDown(600 + 999)).toBe(true);
    expect(usage.isCloudCoolingDown(600 + 1000)).toBe(false);
  });

  it("reports weekly conserve pressure once hits reach the threshold within the window", () => {
    const usage = new UsageManager({
      initialCooldownMs: 1,
      weeklyWindowMs: 7 * 24 * 60 * 60_000,
      weeklyConserveThreshold: 3,
    });
    usage.recordCloudRateLimited(0);
    usage.recordCloudRateLimited(1000);
    expect(usage.shouldConserveCloud(2000)).toBe(false);
    usage.recordCloudRateLimited(2000);
    expect(usage.shouldConserveCloud(2000)).toBe(true);
  });

  it("drops rate-limit hits outside the weekly window from the conserve count", () => {
    const weekMs = 7 * 24 * 60 * 60_000;
    const usage = new UsageManager({ initialCooldownMs: 1, weeklyWindowMs: weekMs, weeklyConserveThreshold: 2 });
    usage.recordCloudRateLimited(0);
    usage.recordCloudRateLimited(1000);
    expect(usage.shouldConserveCloud(1000)).toBe(true);
    // Well past the weekly window from both hits.
    expect(usage.shouldConserveCloud(1000 + weekMs + 1)).toBe(false);
  });

  it("status() reports a consistent snapshot", () => {
    const usage = new UsageManager({ initialCooldownMs: 1000, weeklyConserveThreshold: 1 });
    usage.recordCloudRateLimited(0);
    const status = usage.status(400);
    expect(status).toEqual({
      coolingDown: true,
      cooldownRemainingMs: 600,
      weeklyHits: 1,
      conserve: true,
    });
  });
});
