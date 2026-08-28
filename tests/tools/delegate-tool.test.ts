import { DelegateToLocalTool } from "../../src/tools/delegate-tool.js";
import type { LocalWorker, LocalResult } from "../../src/provider/local-worker.js";

function makeWorker(result: LocalResult): LocalWorker {
  return { execute: jest.fn(async () => result) } as unknown as LocalWorker;
}

describe("DelegateToLocalTool", () => {
  it("exposes the delegate_to_local schema", () => {
    const tool = new DelegateToLocalTool(makeWorker({ success: true, attempts: 1 }));
    expect(tool.schema.function.name).toBe("delegate_to_local");
    expect(tool.schema.function.parameters).toMatchObject({
      required: ["task_type", "prompt", "expected_output"],
    });
  });

  it("returns success:true with the worker's output on success", async () => {
    const worker = makeWorker({ success: true, output: "interface User { name: string; }", attempts: 1 });
    const tool = new DelegateToLocalTool(worker);

    const result = await tool.call({
      task_type: "ts_interface",
      prompt: "Generate an interface for User with name:string",
      expected_output: "typescript",
    });

    expect(result).toEqual({ success: true, output: "interface User { name: string; }" });
    expect(worker.execute).toHaveBeenCalledWith({
      type: "ts_interface",
      prompt: "Generate an interface for User with name:string",
      expectedOutput: "typescript",
      examples: undefined,
    });
  });

  it("returns success:false with the worker's error on failure, without throwing", async () => {
    const worker = makeWorker({ success: false, error: "Output failed validation after 2 attempts", attempts: 2 });
    const tool = new DelegateToLocalTool(worker);

    const result = await tool.call({
      task_type: "regex",
      prompt: "Write a regex for email addresses",
      expected_output: "regex",
    });

    expect(result).toEqual({ success: false, error: "Output failed validation after 2 attempts" });
  });
});
