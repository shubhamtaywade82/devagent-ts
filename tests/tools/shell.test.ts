import { EventEmitter } from "node:events";

jest.mock("node:child_process");

import { spawn } from "node:child_process";
import { ShellTool } from "../../src/tools/shell";

const mockSpawn = spawn as jest.Mock;

interface FakeProc extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: jest.Mock;
}

function fakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  return proc;
}

afterEach(() => {
  mockSpawn.mockReset();
  jest.useRealTimers();
});

function skipDockerPreflight(tool: ShellTool): void {
  (tool as any).dockerChecked = true;
  (tool as any).dockerAvailable = true;
}

describe("ShellTool", () => {
  it("returns exitCode and output on successful execution", async () => {
    const proc = fakeProc();
    mockSpawn.mockReturnValue(proc);

    const tool = new ShellTool({ workspaceRoot: "/tmp/ws" });
    skipDockerPreflight(tool);
    const promise = tool.call({ command: "echo hi" });

    proc.stdout.emit("data", Buffer.from("hi\n"));
    proc.stderr.emit("data", Buffer.from(""));
    proc.emit("close", 0);

    expect(await promise).toMatchObject({ exitCode: 0, stdout: "hi\n" });
  });

  it("returns non-zero exitCode on command failure", async () => {
    const proc = fakeProc();
    mockSpawn.mockReturnValue(proc);

    const tool = new ShellTool({ workspaceRoot: "/tmp/ws" });
    skipDockerPreflight(tool);
    const promise = tool.call({ command: "false" });

    proc.stderr.emit("data", Buffer.from("error"));
    proc.emit("close", 1);

    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("error");
  });

  it("returns an error payload when docker binary cannot be spawned (fail-closed)", async () => {
    const proc = fakeProc();
    mockSpawn.mockReturnValue(proc);

    const tool = new ShellTool({ workspaceRoot: "/tmp/ws" });
    skipDockerPreflight(tool);
    const promise = tool.call({ command: "echo" });

    proc.emit("error", new Error("ENOENT"));

    const result = await promise;
    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toMatch(/failed to spawn docker/);
  });

  it("truncates output that exceeds MAX_OUTPUT_BYTES and returns BufferExceededError", async () => {
    jest.useFakeTimers();

    const proc = fakeProc();
    const killProc = fakeProc();
    mockSpawn.mockReturnValueOnce(proc).mockReturnValue(killProc);

    const tool = new ShellTool({ workspaceRoot: "/tmp/ws" });
    skipDockerPreflight(tool);
    const promise = tool.call({ command: "yes" });

    proc.stdout.emit("data", Buffer.alloc(ShellTool.MAX_OUTPUT_BYTES, "a"));
    proc.stdout.emit("data", Buffer.from("more"));

    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");

    killProc.emit("close", 0);
    proc.emit("close", -1);

    const result = await promise;
    expect(result.error).toBe("BufferExceededError");
    expect(result.truncated).toBe(true);
  });

  it("returns a DockerUnavailableError instead of a raw spawn error when docker is missing", async () => {
    const tool = new ShellTool({ workspaceRoot: "/tmp/ws", logger: { info: jest.fn(), warn: jest.fn() } });
    (tool as any).dockerAvailable = false;
    (tool as any).dockerChecked = true;

    const result = await tool.call({ command: "echo hi" });

    expect(result.error).toBe("DockerUnavailableError");
    expect(result.exitCode).toBe(-1);
  });

  it("includes expected docker security flags", () => {
    const tool = new ShellTool({ workspaceRoot: "/tmp/ws", timeoutSec: 15 });
    const args = (tool as any).dockerArgs("c1", "echo hi");

    expect(args).toContain("--network=none");
    expect(args).toContain("--pids-limit=128");
    expect(args).toContain("timeout");
    expect(args).toContain("15");
  });
});
