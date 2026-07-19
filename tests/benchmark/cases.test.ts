import { BUILTIN_CASES } from "../../src/benchmark/cases.js";
import { ChatResponse } from "../../src/provider/provider.js";
import { SingleTurnBenchmarkCase } from "../../src/benchmark/types.js";

// BUILTIN_CASES is entirely single-turn today, but its declared type is the
// BenchmarkCase union (shared with the agentic case builders) — narrow here
// so `.validate` resolves to the single-turn (ChatResponse) signature.
function findCase(id: string): SingleTurnBenchmarkCase {
  const found = BUILTIN_CASES.find((c) => c.id === id);
  if (!found || found.kind === "agentic") throw new Error(`expected a single-turn case named ${id}`);
  return found;
}

const jsonCase = findCase("json-validity");
const toolCase = findCase("tool-calling");

function response(overrides: Partial<ChatResponse["message"]> = {}): ChatResponse {
  return { message: { role: "assistant", content: "", ...overrides }, done: true };
}

describe("json-validity case", () => {
  it("passes on exact valid JSON", () => {
    expect(jsonCase.validate(response({ content: '{"answer": 4}' })).pass).toBe(true);
  });

  it("passes when the model wraps JSON in a markdown fence anyway", () => {
    expect(jsonCase.validate(response({ content: '```json\n{"answer": 4}\n```' })).pass).toBe(true);
  });

  it("fails on invalid JSON", () => {
    const result = jsonCase.validate(response({ content: "the answer is 4" }));
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/not valid JSON/);
  });

  it("fails on the wrong value", () => {
    const result = jsonCase.validate(response({ content: '{"answer": 5}' }));
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/expected answer:4/);
  });
});

describe("tool-calling case", () => {
  it("passes when the model calls get_weather with Paris", () => {
    const result = toolCase.validate(
      response({
        content: "",
        tool_calls: [{ function: { name: "get_weather", arguments: { city: "Paris" } } }],
      }),
    );
    expect(result.pass).toBe(true);
  });

  it("passes when arguments arrive as a JSON string (some models do this)", () => {
    const result = toolCase.validate(
      response({
        content: "",
        tool_calls: [{ function: { name: "get_weather", arguments: '{"city":"Paris"}' } }],
      }),
    );
    expect(result.pass).toBe(true);
  });

  it("fails when the model answers in prose instead of calling the tool", () => {
    const result = toolCase.validate(response({ content: "It's sunny in Paris." }));
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/no tool call/);
  });

  it("fails when the wrong tool is called", () => {
    const result = toolCase.validate(
      response({ content: "", tool_calls: [{ function: { name: "search", arguments: { q: "Paris weather" } } }] }),
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/called search/);
  });

  it("fails when the city argument is wrong", () => {
    const result = toolCase.validate(
      response({ content: "", tool_calls: [{ function: { name: "get_weather", arguments: { city: "London" } } }] }),
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/London/);
  });
});

describe("tool-selection-among-distractors case", () => {
  const selectionCase = findCase("tool-selection-among-distractors");

  it("passes when get_time is called", () => {
    const result = selectionCase.validate(
      response({ content: "", tool_calls: [{ function: { name: "get_time", arguments: { city: "Tokyo" } } }] }),
    );
    expect(result.pass).toBe(true);
  });

  it("fails when a distractor tool is called instead", () => {
    const result = selectionCase.validate(
      response({ content: "", tool_calls: [{ function: { name: "get_weather", arguments: { city: "Tokyo" } } }] }),
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/called get_weather/);
  });
});

describe("tool-call-typed-arguments case", () => {
  const alarmCase = findCase("tool-call-typed-arguments");

  it("passes with correctly-typed number and boolean args", () => {
    const result = alarmCase.validate(
      response({ content: "", tool_calls: [{ function: { name: "set_alarm", arguments: { hour: 7, repeat: true } } }] }),
    );
    expect(result.pass).toBe(true);
  });

  it("tolerates stringified number/boolean args", () => {
    const result = alarmCase.validate(
      response({ content: "", tool_calls: [{ function: { name: "set_alarm", arguments: { hour: "7", repeat: "true" } } }] }),
    );
    expect(result.pass).toBe(true);
  });

  it("fails on the wrong hour", () => {
    const result = alarmCase.validate(
      response({ content: "", tool_calls: [{ function: { name: "set_alarm", arguments: { hour: 8, repeat: true } } }] }),
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/hour was/);
  });
});

describe("no-unnecessary-tool-call case", () => {
  const directCase = findCase("no-unnecessary-tool-call");

  it("passes when the model answers directly with the correct number", () => {
    expect(directCase.validate(response({ content: "54" })).pass).toBe(true);
  });

  it("fails when the model calls a tool unnecessarily", () => {
    const result = directCase.validate(
      response({ content: "", tool_calls: [{ function: { name: "get_weather", arguments: { city: "x" } } }] }),
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/called a tool/);
  });

  it("fails when the answer is wrong", () => {
    const result = directCase.validate(response({ content: "42" }));
    expect(result.pass).toBe(false);
  });
});

describe("reasoning-multi-step-math case", () => {
  const mathCase = findCase("reasoning-multi-step-math");

  it("passes when the correct final number appears", () => {
    expect(mathCase.validate(response({ content: "120 * 0.65 = 78, 78 - 20 = 58" })).pass).toBe(true);
  });

  it("fails on the wrong number", () => {
    const result = mathCase.validate(response({ content: "The answer is 60." }));
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/expected final answer 58/);
  });
});

describe("reasoning-logic-deduction case", () => {
  const logicCase = findCase("reasoning-logic-deduction");

  it("passes when Carol is named", () => {
    expect(logicCase.validate(response({ content: "Carol is the shortest." })).pass).toBe(true);
  });

  it("fails when the wrong name is given", () => {
    expect(logicCase.validate(response({ content: "Bob is the shortest." })).pass).toBe(false);
  });
});

describe("thinking-shows-work case", () => {
  const thinkingCase = findCase("thinking-shows-work");

  it("passes on the correct final answer regardless of a thinking field", () => {
    expect(thinkingCase.validate(response({ content: "17 * 23 = 391" })).pass).toBe(true);
  });

  it("notes when a separate thinking field is present, without affecting pass/fail", () => {
    const withThinking = thinkingCase.validate(response({ content: "391", thinking: "17*23 = 17*20 + 17*3 = 340+51 = 391" } as any));
    expect(withThinking.pass).toBe(true);
    expect(withThinking.reason).toMatch(/thinking field/);
  });

  it("fails on the wrong answer", () => {
    expect(thinkingCase.validate(response({ content: "391 is wrong, it's 400" })).pass).toBe(false);
  });
});
