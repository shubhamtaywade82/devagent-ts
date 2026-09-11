import { spawn } from "node:child_process";
import { Tool } from "./tool.js";

const ALLOWED_SUBCOMMANDS = new Set([
  "status",
  "diff",
  "log",
  "branch",
  "add",
  "commit",
  "checkout",
  "stash",
  "show",
  "blame",
  "rev-parse",
  "cherry-pick",
  "pull",
  "push",
]);

const DISALLOWED_FLAG_PATTERNS = [/^--hard$/, /^--force$/, /^-f$/, /^-D$/, /^--force-with-lease$/, /^\+.*$/];
const PROTECTED_BRANCHES = new Set(["main", "master", "develop", "prod", "production"]);

function isProtectedBranchTarget(args: string[]): boolean {
  return args.some((a) => PROTECTED_BRANCHES.has(a.replace(/^refs\/heads\//, "")) || a.startsWith("release/"));
}

/** Same ceiling and rationale as ShellTool.MAX_OUTPUT_BYTES: this output goes
 * straight back to the model as a tool message. `git log` or `git diff` on a
 * large repo previously accumulated unbounded into memory and then into the
 * context window. */
const MAX_OUTPUT_BYTES = 32 * 1024;

export class GitTool extends Tool {
  constructor(private readonly root: string) {
    super();
  }

  get name(): string {
    return "git";
  }

  get description(): string {
    return "Run a git subcommand (status, diff, log, branch, add, commit, checkout, stash, show, blame, rev-parse, cherry-pick, pull, push). Force operations and pushing to main/master are blocked; push working feature branches and open PRs.";
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: { args: { type: "array", items: { type: "string" } } },
      required: ["args"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const gitArgs = args.args as string[];
    if (!Array.isArray(gitArgs) || gitArgs.length === 0) {
      return { error: "ArgumentError", message: "args must be a non-empty string array" };
    }

    const subcommand = gitArgs[0];
    if (!ALLOWED_SUBCOMMANDS.has(subcommand)) {
      return { error: "DisallowedGitCommandError", message: `git ${subcommand} is not on the allowlist` };
    }
    if (gitArgs.some((a) => DISALLOWED_FLAG_PATTERNS.some((p) => p.test(a)))) {
      return {
        error: "DisallowedGitCommandError",
        message: `flags in [${gitArgs.join(" ")}] are blocked (force/hard operations)`,
      };
    }
    if (subcommand === "push" && isProtectedBranchTarget(gitArgs)) {
      return {
        error: "DisallowedGitCommandError",
        message: `pushing directly to protected branches (main/master/develop) is blocked; push to a feature branch instead`,
      };
    }

    return new Promise((resolvePromise) => {
      const child = spawn("git", gitArgs, { cwd: this.root });
      // Buffers, decoded once at the end: concatenating per-chunk toString()
      // corrupts multi-byte characters split across a chunk boundary, which
      // shows up as mojibake in diffs and commit messages.
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      child.stdout.on("data", (c: Buffer) => {
        if (stdout.byteLength < MAX_OUTPUT_BYTES) stdout = Buffer.concat([stdout, c]);
      });
      child.stderr.on("data", (c: Buffer) => {
        if (stderr.byteLength < MAX_OUTPUT_BYTES) stderr = Buffer.concat([stderr, c]);
      });
      child.on("close", (exitCode) => {
        const truncated = stdout.byteLength > MAX_OUTPUT_BYTES || stderr.byteLength > MAX_OUTPUT_BYTES;
        resolvePromise({
          command: `git ${gitArgs.join(" ")}`,
          exitCode: exitCode ?? -1,
          stdout: stdout.subarray(0, MAX_OUTPUT_BYTES).toString("utf-8"),
          stderr: stderr.subarray(0, MAX_OUTPUT_BYTES).toString("utf-8"),
          truncated,
        });
      });
      child.on("error", (err) => {
        resolvePromise({ command: `git ${gitArgs.join(" ")}`, exitCode: -1, stdout: "", stderr: err.message });
      });
    });
  }
}
