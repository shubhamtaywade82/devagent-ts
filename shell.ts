import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { Tool } from "./tool";

export interface ShellToolOptions {
  workspaceRoot: string;
  image?: string;
  timeoutSec?: number;
  memory?: string;
  cpus?: string;
  logger?: Pick<Console, "info" | "warn">;
}

export class ShellTool extends Tool {
  static readonly MAX_OUTPUT_BYTES = 2 * 1024 * 1024; // 2MB ceiling — exceeding this kills the process, it does not silently truncate
  static readonly DEFAULT_TIMEOUT_SEC = 30;
  static readonly DEFAULT_IMAGE = "devagent-sandbox:latest";
  static readonly KILL_POLL_INTERVAL_MS = 300;
  static readonly KILL_ESCALATION_MS = 3000;

  private readonly root: string;
  private readonly image: string;
  private readonly timeoutSec: number;
  private readonly memory: string;
  private readonly cpus: string;
  private readonly logger: Pick<Console, "info" | "warn">;

  constructor(opts: ShellToolOptions) {
    super();
    this.root = opts.workspaceRoot;
    this.image = opts.image ?? ShellTool.DEFAULT_IMAGE;
    this.timeoutSec = opts.timeoutSec ?? ShellTool.DEFAULT_TIMEOUT_SEC;
    this.memory = opts.memory ?? "512m";
    this.cpus = opts.cpus ?? "1";
    this.logger = opts.logger ?? console;
  }

  get name(): string {
    return "run_shell";
  }

  get description(): string {
    return "Run a shell command inside an isolated, network-disabled sandbox rooted at the workspace.";
  }

  get parameters(): Record<string, unknown> {
    return { type: "object", properties: { command: { type: "string" } }, required: ["command"] };
  }

  call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const command = args.command as string;
    const container = `devagent-${randomBytes(4).toString("hex")}`;

    return new Promise((resolvePromise) => {
      const child = spawn("docker", this.dockerArgs(container, command));
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let settled = false;
      let killedForOverflow = false;

      const finish = (payload: Record<string, unknown>) => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimeout);
        resolvePromise(payload);
      };

      const checkOverflow = () => {
        if (killedForOverflow) return;
        if (stdout.byteLength + stderr.byteLength <= ShellTool.MAX_OUTPUT_BYTES) return;

        killedForOverflow = true;
        child.kill("SIGKILL");
        this.logger.warn(`[ShellTool] ${container} exceeded output ceiling — SIGKILL issued`);
        void this.escalateKill(container);
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = Buffer.concat([stdout, chunk]);
        checkOverflow();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = Buffer.concat([stderr, chunk]);
        checkOverflow();
      });

      // Two layers of timeout enforcement: `timeout` inside the container
      // bounds the command itself; this outer timer guards against
      // docker/the daemon hanging, and drives kill+escalation if hit.
      const hardTimeout = setTimeout(() => {
        if (settled) return;
        this.logger.warn(`[ShellTool] hard timeout on ${container}`);
        void this.escalateKill(container).then(() => {
          finish({ exitCode: -1, stdout: "", stderr: "sandbox exceeded outer timeout", truncated: false });
        });
      }, (this.timeoutSec + 10) * 1000);

      child.on("close", (exitCode) => {
        if (killedForOverflow) {
          finish({
            exitCode: exitCode ?? -1,
            stdout: stdout.subarray(0, ShellTool.MAX_OUTPUT_BYTES).toString("utf-8"),
            stderr: "output exceeded buffer ceiling; process killed",
            truncated: true,
            error: "BufferExceededError",
          });
          return;
        }

        this.logger.info(`[ShellTool] ${container} exited ${exitCode}`);
        finish({
          exitCode,
          stdout: stdout.subarray(0, ShellTool.MAX_OUTPUT_BYTES).toString("utf-8"),
          stderr: stderr.subarray(0, ShellTool.MAX_OUTPUT_BYTES).toString("utf-8"),
          truncated: stdout.byteLength > ShellTool.MAX_OUTPUT_BYTES || stderr.byteLength > ShellTool.MAX_OUTPUT_BYTES,
        });
      });

      // Fires if the `docker` binary itself is missing/unreachable —
      // this is the fail-closed path, not a fallback to unsandboxed exec.
      child.on("error", (err) => {
        finish({ exitCode: -1, stdout: "", stderr: `failed to spawn docker: ${err.message}`, truncated: false });
      });
    });
  }

  // docker kill, then poll container state; escalate to `docker rm -f`
  // if it's still alive after KILL_ESCALATION_MS. Guarantees resource
  // recovery even if the container ignores the initial kill signal.
  private async escalateKill(container: string): Promise<void> {
    await this.runDocker(["kill", container]);

    const deadline = Date.now() + ShellTool.KILL_ESCALATION_MS;
    while (Date.now() < deadline) {
      if (!(await this.containerRunning(container))) return;
      await new Promise((r) => setTimeout(r, ShellTool.KILL_POLL_INTERVAL_MS));
    }

    if (await this.containerRunning(container)) {
      this.logger.warn(`[ShellTool] ${container} survived docker kill — escalating to rm -f`);
      await this.runDocker(["rm", "-f", container]);
    }
  }

  private runDocker(args: string[]): Promise<void> {
    return new Promise((resolveRun) => {
      const proc = spawn("docker", args);
      proc.on("close", () => resolveRun());
      proc.on("error", () => resolveRun()); // best-effort — never let cleanup itself hang or throw
    });
  }

  private containerRunning(container: string): Promise<boolean> {
    return new Promise((resolveCheck) => {
      const check = spawn("docker", ["inspect", "-f", "{{.State.Running}}", container]);
      let out = "";
      check.stdout.on("data", (c: Buffer) => (out += c.toString()));
      check.on("close", (code) => resolveCheck(code === 0 && out.trim() === "true"));
      check.on("error", () => resolveCheck(false));
    });
  }

  private dockerArgs(container: string, command: string): string[] {
    return [
      "run",
      "--rm",
      "--name",
      container,
      "--network=none",
      `--memory=${this.memory}`,
      `--cpus=${this.cpus}`,
      "--pids-limit=128",
      "-v",
      `${resolve(this.root)}:/workspace:rw`,
      "-w",
      "/workspace",
      this.image,
      "timeout",
      String(this.timeoutSec),
      "sh",
      "-c",
      command,
    ];
  }
}
