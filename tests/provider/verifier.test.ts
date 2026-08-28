import { Verifier } from "../../src/provider/verifier.js";
import type { Provider, ChatResponse } from "../../src/provider/provider.js";



function makeProvider(reply: string): Provider {
  return {
    chat: jest.fn(async () => ({
      message: { role: "assistant", content: reply },
      done: true,
    }) as ChatResponse),
  } as unknown as Provider;
}

describe("Verifier", () => {
  it("returns VERIFIED when model outputs VERIFIED", async () => {
    const verifier = new Verifier(makeProvider("VERIFIED"));
    const result = await verifier.verify("What is 2+2?", "4");
    expect(result.verdict).toBe("VERIFIED");
    expect(result.issues).toBeUndefined();
  });

  it("returns VERIFIED when model outputs VERIFIED with trailing text", async () => {
    const verifier = new Verifier(makeProvider("VERIFIED\nThe answer looks correct."));
    const result = await verifier.verify("Simple math", "4");
    expect(result.verdict).toBe("VERIFIED");
  });

  it("returns REJECT with issues extracted from bullet points", async () => {
    const reply = "REJECT\n- Wrong type used\n- Missing null check";
    const verifier = new Verifier(makeProvider(reply));
    const result = await verifier.verify("Generate interface", "const x = 1");
    expect(result.verdict).toBe("REJECT");
    expect(result.issues).toHaveLength(2);
    expect(result.issues![0]).toBe("Wrong type used");
    expect(result.issues![1]).toBe("Missing null check");
  });

  it("returns REJECT with fallback message when no bullet points in response", async () => {
    const verifier = new Verifier(makeProvider("This answer seems wrong but I can't explain why."));
    const result = await verifier.verify("Some task", "Some answer");
    expect(result.verdict).toBe("REJECT");
    expect(result.issues).toHaveLength(1);
    expect(result.issues![0]).toMatch(/unspecified/);
  });

  it("returns REJECT for empty-ish response", async () => {
    const verifier = new Verifier(makeProvider("  "));
    const result = await verifier.verify("task", "answer");
    // Empty/whitespace response doesn't start with VERIFIED
    expect(result.verdict).toBe("REJECT");
  });
});
