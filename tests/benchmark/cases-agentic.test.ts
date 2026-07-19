import { buildAgenticCases } from "../../src/benchmark/cases-agentic.js";
import { AgenticTrajectory } from "../../src/benchmark/types.js";

function findCase(id: string) {
  const cases = buildAgenticCases();
  const found = cases.find((c) => c.id === id);
  if (!found) throw new Error(`no agentic case named ${id}`);
  return found;
}

function trajectory(overrides: Partial<AgenticTrajectory> = {}): AgenticTrajectory {
  return { finalContent: "", toolCallsMade: [], turns: 1, hitMaxTurns: false, ...overrides };
}

describe("react-two-step-tool-chain case", () => {
  const chainCase = findCase("react-two-step-tool-chain");

  it("resolveTool chains lookup_user -> get_balance correctly", async () => {
    const lookup = await chainCase.resolveTool("lookup_user", { name: "jdoe" });
    expect(lookup).toEqual({ id: "u123" });
    const balance = await chainCase.resolveTool("get_balance", { id: "u123" });
    expect(balance).toEqual({ balance: 450 });
  });

  it("resolveTool errors on an unknown user or wrong id", async () => {
    expect(await chainCase.resolveTool("lookup_user", { name: "nobody" })).toEqual({ error: "user not found" });
    expect(await chainCase.resolveTool("get_balance", { id: "wrong" })).toEqual({ error: "unknown account id" });
  });

  it("passes when both tools were called in order and the balance is in the final answer", () => {
    const result = chainCase.validate(
      trajectory({
        toolCallsMade: [
          { name: "lookup_user", args: { name: "jdoe" }, result: { id: "u123" } },
          { name: "get_balance", args: { id: "u123" }, result: { balance: 450 } },
        ],
        finalContent: "The balance is 450.",
      }),
    );
    expect(result.pass).toBe(true);
  });

  it("fails when get_balance is never called", () => {
    const result = chainCase.validate(
      trajectory({ toolCallsMade: [{ name: "lookup_user", args: {}, result: { id: "u123" } }], finalContent: "450" }),
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/never called get_balance/);
  });

  it("fails when the final answer doesn't mention the balance", () => {
    const result = chainCase.validate(
      trajectory({
        toolCallsMade: [
          { name: "lookup_user", args: {}, result: { id: "u123" } },
          { name: "get_balance", args: { id: "u123" }, result: { balance: 450 } },
        ],
        finalContent: "I found the account.",
      }),
    );
    expect(result.pass).toBe(false);
  });
});

describe("react-error-recovery case", () => {
  it("errors on the first call and succeeds after, per case instance", async () => {
    const recoveryCase = findCase("react-error-recovery");
    expect(await recoveryCase.resolveTool("fetch_note", { id: "n1" })).toEqual({ error: "transient failure, please retry" });
    expect(await recoveryCase.resolveTool("fetch_note", { id: "n1" })).toEqual({ content: "the launch code is orion-seven" });
  });

  it("a fresh call to buildAgenticCases() gets an independent call counter", async () => {
    const first = findCase("react-error-recovery");
    const second = findCase("react-error-recovery");

    expect(await first.resolveTool("fetch_note", {})).toEqual({ error: "transient failure, please retry" });
    // `second` is a completely separate case instance (own closure) — its
    // first call must also error, not continue from `first`'s call count.
    expect(await second.resolveTool("fetch_note", {})).toEqual({ error: "transient failure, please retry" });
  });

  it("passes when the model retried and the final answer has the note content", () => {
    const recoveryCase = findCase("react-error-recovery");
    const result = recoveryCase.validate(
      trajectory({
        toolCallsMade: [
          { name: "fetch_note", args: {}, result: { error: "transient failure, please retry" } },
          { name: "fetch_note", args: {}, result: { content: "the launch code is orion-seven" } },
        ],
        finalContent: "The note says: the launch code is orion-seven.",
      }),
    );
    expect(result.pass).toBe(true);
  });

  it("fails when the model gave up after a single failed call", () => {
    const recoveryCase = findCase("react-error-recovery");
    const result = recoveryCase.validate(
      trajectory({
        toolCallsMade: [{ name: "fetch_note", args: {}, result: { error: "transient failure, please retry" } }],
        finalContent: "I couldn't fetch the note.",
      }),
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/gave up/);
  });
});

describe("escalate-on-hard-task case", () => {
  const hardCase = findCase("escalate-on-hard-task");

  it("passes when escalate_task was called", () => {
    const result = hardCase.validate(
      trajectory({ toolCallsMade: [{ name: "escalate_task", args: { reason: "too complex" }, result: { escalate: true } }] }),
    );
    expect(result.pass).toBe(true);
  });

  it("fails when escalate_task was never called", () => {
    const result = hardCase.validate(trajectory({ toolCallsMade: [], finalContent: "here is a design..." }));
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/did not call escalate_task/);
  });
});

describe("no-false-escalate-on-easy-task case", () => {
  const easyCase = findCase("no-false-escalate-on-easy-task");

  it("passes when the model answers directly without escalating", () => {
    const result = easyCase.validate(trajectory({ finalContent: "12" }));
    expect(result.pass).toBe(true);
  });

  it("fails when the model escalates an easy question", () => {
    const result = easyCase.validate(
      trajectory({ toolCallsMade: [{ name: "escalate_task", args: {}, result: { escalate: true } }], finalContent: "" }),
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/escalated an easy/);
  });
});
