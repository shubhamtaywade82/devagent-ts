import { EventEmitter } from "node:events";

jest.mock("node:child_process", () => ({ spawn: jest.fn() }));
import { spawn } from "node:child_process";
import { ShellTool } from "../src/tools/shell";

function fakeChild() {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  return child;
}

const noopLogger = { info: jest.fn(), warn: jest.fn() };

describe("ShellTool", () => {
  beforeEach(() => {
    (spawn as jest.Mock).mockReset();
  });

  it("returns exit code and captured output on success", async () => {
    const child = fakeChild();
    (spawn as jest.Mock).mockReturnValue(child);

    const tool = new ShellTool({ workspaceRoot: "/tmp", timeoutSec: 2, logger: noopLogger });
    const promise = tool.call({ command: "echo out" });

    child.stdout.emit("data", Buffer.from("out\n"));
    child.emit("close", 0);

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("out\n");
  });

  it("SIGKILLs the process and reports BufferExceededError when cumulative output exceeds the ceiling", async () => {
    const child = fakeChild();
    // docker kill / inspect calls fired by escalateKill during the test
    (spawn as jest.Mock).mockReturnValueOnce(child).mockImplementation(() => fakeChild());

    const tool = new ShellTool({ workspaceRoot: "/tmp", timeoutSec: 2, logger: noopLogger });
    const promise = tool.call({ command: "yes x" });

    child.stdout.emit("data", Buffer.alloc(ShellTool.MAX_OUTPUT_BYTES + 10, "x"));
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    child.emit("close", null);

    const result = await promise;
    expect(result.error).toBe("BufferExceededError");
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.stdout as string)).toBeLessThanOrEqual(ShellTool.MAX_OUTPUT_BYTES);
  });

  it("reports a spawn failure (e.g. docker missing) as a tool payload, not a throw", async () => {
    const child = fakeChild();
    (spawn as jest.Mock).mockReturnValue(child);

    const tool = new ShellTool({ workspaceRoot: "/tmp", timeoutSec: 2, logger: noopLogger });
    const promise = tool.call({ command: "echo out" });

    child.emit("error", new Error("ENOENT: docker not found"));

    const result = await promise;
    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toMatch(/failed to spawn docker/);
  });

  it("issues docker kill when the outer timeout fires", async () => {
    jest.useFakeTimers();
    const child = fakeChild();
    const killAndInspectCalls: string[][] = [];

    (spawn as jest.Mock).mockImplementation((_cmd: string, args: string[] = []) => {
      if (args[0] === "run") return child;
      killAndInspectCalls.push(args);
      if (args[0] === "inspect") {
        const inspectChild = fakeChild();
        queueMicrotask(() => {
          inspectChild.stdout.emit("data", Buffer.from("false\n"));
          inspectChild.emit("close", 0);
        });
        return inspectChild;
      }
      const closingChild = fakeChild();
      queueMicrotask(() => closingChild.emit("close", 0));
      return closingChild;
    });

    const tool = new ShellTool({ workspaceRoot: "/tmp", timeoutSec: 1, logger: noopLogger });
    const promise = tool.call({ command: "sleep 100" });

    await jest.advanceTimersByTimeAsync(11_000); // timeoutSec(1) + 10s outer buffer

    const result = await promise;
    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toMatch(/outer timeout/);
    expect(killAndInspectCalls.some((a) => a[0] === "kill")).toBe(true);

    jest.useRealTimers();
  });
});
