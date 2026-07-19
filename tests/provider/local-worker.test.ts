import { LocalWorker, LocalTask } from "../../src/provider/local-worker.js";
import type { Provider, ChatResponse } from "../../src/provider/provider.js";



function makeProvider(responses: string[]): Provider {
  let call = 0;
  return {
    chat: jest.fn(async () => {
      const content = responses[Math.min(call++, responses.length - 1)];
      return {
        message: { role: "assistant", content },
        done: true,
      } as ChatResponse;
    }),
  } as unknown as Provider;
}

const VALID_INTERFACE = `interface User {
  name: string;
  age: number;
}`;

const INVALID_INTERFACE = "here is a user with name and age";

describe("LocalWorker", () => {
  it("returns success:true when output is valid TypeScript", async () => {
    const provider = makeProvider([VALID_INTERFACE]);
    const worker = new LocalWorker(provider);
    const task: LocalTask = {
      type: "ts_interface",
      prompt: "Generate an interface for User with name:string and age:number",
      expectedOutput: "typescript",
    };
    const result = await worker.execute(task);
    expect(result.success).toBe(true);
    expect(result.output).toContain("interface");
    expect(result.attempts).toBe(1);
  });

  it("retries once on validation failure then succeeds", async () => {
    const provider = makeProvider([INVALID_INTERFACE, VALID_INTERFACE]);
    const worker = new LocalWorker(provider);
    const task: LocalTask = {
      type: "ts_interface",
      prompt: "Generate an interface for User",
      expectedOutput: "typescript",
    };
    const result = await worker.execute(task);
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it("returns success:false after 2 failed validation attempts", async () => {
    const provider = makeProvider([INVALID_INTERFACE, INVALID_INTERFACE]);
    const worker = new LocalWorker(provider);
    const task: LocalTask = {
      type: "ts_interface",
      prompt: "Generate an interface for User",
      expectedOutput: "typescript",
    };
    const result = await worker.execute(task);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.validationError).toBeDefined();
  });

  it("strips TypeScript markdown code fences", () => {
    const worker = new LocalWorker({} as unknown as Provider);
    expect(worker.stripCodeFences("```typescript\ninterface Foo {}\n```")).toBe("interface Foo {}");
    expect(worker.stripCodeFences("```\nsome code\n```")).toBe("some code");
    expect(worker.stripCodeFences("plain text")).toBe("plain text");
  });

  it("validates valid JSON", async () => {
    const provider = makeProvider(['{"name": "Alice", "age": 30}']);
    const worker = new LocalWorker(provider);
    const task: LocalTask = { type: "parse", prompt: "Extract name and age", expectedOutput: "json" };
    const result = await worker.execute(task);
    expect(result.success).toBe(true);
  });

  it("returns success:false on invalid JSON with no retry path", async () => {
    const provider = makeProvider(["not json at all }", "still not json"]);
    const worker = new LocalWorker(provider);
    const task: LocalTask = { type: "parse", prompt: "Extract fields", expectedOutput: "json" };
    const result = await worker.execute(task);
    expect(result.success).toBe(false);
  });

  it("handles provider throwing an error gracefully", async () => {
    const provider = {
      chat: jest.fn(async () => {
        throw new Error("model timeout");
      }),
    } as unknown as Provider;
    const worker = new LocalWorker(provider);
    const task: LocalTask = { type: "regex", prompt: "Match emails", expectedOutput: "regex" };
    const result = await worker.execute(task);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/model timeout/);
  });
});
