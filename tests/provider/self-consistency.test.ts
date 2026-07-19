import { SelfConsistency } from "../../src/provider/self-consistency.js";
import type { Provider, ChatResponse } from "../../src/provider/provider.js";



function makeProvider(replies: string[]): Provider {
  let call = 0;
  return {
    chat: jest.fn(async () => ({
      message: { role: "assistant", content: replies[call++ % replies.length] },
      done: true,
    }) as ChatResponse),
  } as unknown as Provider;
}

describe("SelfConsistency", () => {
  it("scores 1.0 when all 3 samples are identical", async () => {
    const provider = makeProvider(["42", "42", "42"]);
    const sc = new SelfConsistency(provider, { n: 3 });
    const result = await sc.evaluate("What is 6 × 7?");
    expect(result.score).toBe(1.0);
    expect(result.majority).toBe("42");
    expect(result.shouldEscalate).toBe(false);
  });

  it("scores ~0.33 and shouldEscalate:true when all 3 samples differ", async () => {
    const provider = makeProvider(["alpha", "beta", "gamma"]);
    const sc = new SelfConsistency(provider, { n: 3, threshold: 0.5 });
    const result = await sc.evaluate("What colour is the sky?");
    expect(result.score).toBeCloseTo(1 / 3, 1);
    expect(result.shouldEscalate).toBe(true);
  });

  it("scores 2/3 and shouldEscalate:false when 2 of 3 agree", async () => {
    const provider = makeProvider(["yes", "yes", "no"]);
    const sc = new SelfConsistency(provider, { n: 3, threshold: 0.5 });
    const result = await sc.evaluate("Is TypeScript better than JavaScript?");
    expect(result.score).toBeCloseTo(2 / 3, 1);
    expect(result.majority).toBe("yes");
    expect(result.shouldEscalate).toBe(false);
  });

  it("scores correctly with the score() method directly", () => {
    const provider = makeProvider([]);
    const sc = new SelfConsistency(provider, { n: 3, threshold: 0.5 });
    const result = sc.score(["cat", "cat", "dog"]);
    expect(result.score).toBeCloseTo(2 / 3, 1);
    expect(result.majority).toBe("cat");
  });

  it("handles empty samples gracefully with score 0 and shouldEscalate:true", () => {
    const provider = makeProvider([]);
    const sc = new SelfConsistency(provider);
    const result = sc.score([]);
    expect(result.score).toBe(0);
    expect(result.majority).toBeUndefined();
    expect(result.shouldEscalate).toBe(true);
  });

  it("handles errored samples (empty strings) gracefully", () => {
    const provider = makeProvider([]);
    const sc = new SelfConsistency(provider);
    // Simulate 2 errors (empty) + 1 good
    const result = sc.score(["", "", "valid answer"]);
    // Only non-empty samples counted
    expect(result.score).toBe(1.0);
    expect(result.majority).toBe("valid answer");
  });

  it("uses custom threshold", async () => {
    const provider = makeProvider(["yes", "yes", "no"]);
    // High threshold: 2/3 agreement should still escalate
    const sc = new SelfConsistency(provider, { n: 3, threshold: 0.9 });
    const result = await sc.evaluate("Any prompt");
    expect(result.shouldEscalate).toBe(true); // 0.67 < 0.9
  });
});
