/**
 * ApprovalBroker — reusable human-in-the-loop resolver.
 *
 * Extracted from the Agent god-object (src/cli/agent.ts): the destructive
 * classification tables and the pending-approval promise plumbing now live
 * here so CLI, TUI, API, background workers, and the crypto agent share one
 * implementation.
 *
 * The broker does not render anything — it classifies, asks the registered
 * responder, and resolves. UIs plug in via `setResponder`.
 */

export interface ApprovalRequestSpec {
  title: string;
  summary: string;
  tool: string;
  args?: Record<string, unknown>;
}

export type ApprovalResponder = (request: ApprovalRequestSpec) => Promise<boolean>;

// ── Destructive classification (moved verbatim in spirit from cli/agent.ts) ──

const DESTRUCTIVE_SHELL_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*[rf]?[a-z]*(\s|$)/i, // rm -rf / -fr / -r -f, any flag order
  /\bgit\s+push\b.*(--force\b|-f\b)/i,
  /\bdrop\s+(table|database|schema)\b/i,
  /\btruncate\s+table\b/i,
  /\bmkfs\./i,
  />\s*\/dev\/sd[a-z]/i,
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;/, // fork bomb
];

/** Classify whether a legacy tool call needs human approval, and why. */
export function classifyApprovalNeeded(
  name: string,
  args: Record<string, unknown>,
): { title: string; summary: string } | null {
  if (name === "delete_file") {
    const path = typeof args.path === "string" ? args.path : "(unknown path)";
    return { title: `Delete ${path}`, summary: `The agent wants to delete "${path}". This cannot be undone.` };
  }
  if (name === "run_shell") {
    const command = typeof args.command === "string" ? args.command : "";
    if (DESTRUCTIVE_SHELL_PATTERNS.some((p) => p.test(command))) {
      return { title: "Run destructive shell command", summary: command };
    }
  }
  if (name === "git") {
    const gitArgs = Array.isArray(args.args) ? (args.args as string[]) : [];
    if (gitArgs[0] === "push") {
      return { title: "Push git branch", summary: `The agent wants to run "git ${gitArgs.join(" ")}".` };
    }
  }
  if (name === "github") {
    const ghArgs = Array.isArray(args.args) ? (args.args as string[]) : [];
    if (ghArgs[0] === "pr" && ghArgs[1] === "create") {
      return { title: "Create Pull Request", summary: `The agent wants to run "gh ${ghArgs.join(" ")}".` };
    }
  }
  return null;
}

// ── Broker ──────────────────────────────────────────────────────────────────

export class ApprovalBroker {
  private responder: ApprovalResponder | null = null;
  private readonly pending = new Map<string, (approved: boolean) => void>();
  private seq = 0;

  constructor(private readonly autoApprove = false) {}

  setResponder(responder: ApprovalResponder | null): void {
    this.responder = responder;
  }

  get hasResponder(): boolean {
    return this.responder !== null;
  }

  pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Ask for approval. With autoApprove or no responder, returns true
   * (headless runs are explicitly unattended; gating happens in the
   * PolicyEngine instead of blocking forever).
   */
  async request(spec: ApprovalRequestSpec): Promise<boolean> {
    if (this.autoApprove) return true;
    if (!this.responder) return true;

    const id = `approval_${++this.seq}`;
    return new Promise<boolean>((resolve) => {
      this.pending.set(id, resolve);
      this.responder!(spec)
        .then((approved) => {
          if (this.pending.delete(id)) resolve(approved);
        })
        .catch(() => {
          if (this.pending.delete(id)) resolve(false);
        });
    });
  }

  /** Resolve a pending request programmatically (tests, IPC, TUI overlays). */
  resolveAll(approved: boolean): void {
    for (const [id, resolve] of [...this.pending]) {
      this.pending.delete(id);
      resolve(approved);
    }
  }
}
