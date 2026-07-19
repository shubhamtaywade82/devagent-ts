import { Tool } from "./tool.js";

export class EscalateTaskTool extends Tool {
  get name(): string {
    return "escalate_task";
  }

  get description(): string {
    return "Call this instead of guessing when the current task is beyond what you can reliably " +
      "handle: complex multi-file changes, architecture or design decisions, deep reasoning, " +
      "ambiguous requirements, or anything you are not confident you can do correctly and safely. " +
      "A stronger model will take over with your full conversation history, including everything " +
      "you've already done. Do not call this for simple lookups, small edits, or tasks you're confident about.";
  }

  get tags(): string[] {
    return ["meta", "escalation"];
  }

  get parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: { reason: { type: "string", description: "Why this task needs a stronger model" } },
      required: ["reason"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const reason = typeof args.reason === "string" && args.reason.trim() ? args.reason : "unspecified";
    return { escalate: true, reason };
  }
}
