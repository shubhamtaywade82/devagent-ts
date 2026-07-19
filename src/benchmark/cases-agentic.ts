import { EscalateTaskTool } from "../tools/escalate-tool.js";
import { AgenticBenchmarkCase } from "./types.js";

const LOOKUP_USER_TOOL = {
  type: "function" as const,
  function: {
    name: "lookup_user",
    description: "Look up a user's internal account id by username",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
};

const GET_BALANCE_TOOL = {
  type: "function" as const,
  function: {
    name: "get_balance",
    description: "Get the account balance for an internal account id",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
};

const FETCH_NOTE_TOOL = {
  type: "function" as const,
  function: {
    name: "fetch_note",
    description: "Fetch the contents of a stored note by id",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
};

const escalateTaskSchema = new EscalateTaskTool().schema;

// buildAgenticCases returns freshly-closured cases every call — required for
// react-error-recovery, whose resolveTool tracks a per-run call count (see
// runBenchmark's factory-vs-array note in runner.ts). The other cases here
// are stateless and would work fine as a static array too, but are bundled
// in the same factory for consistency.
export function buildAgenticCases(): AgenticBenchmarkCase[] {
  return [
    {
      id: "react-two-step-tool-chain",
      kind: "agentic",
      category: "agentic-looping",
      description: "Chains two tool calls — uses the first result as an input to the second",
      messages: [
        {
          role: "user",
          content:
            "What is the account balance for user 'jdoe'? Look up their account id first, " +
            "then use it to get the balance. Report the final balance.",
        },
      ],
      tools: [LOOKUP_USER_TOOL, GET_BALANCE_TOOL],
      maxTurns: 6,
      resolveTool: async (name, args) => {
        if (name === "lookup_user") {
          const uname = String(args.name ?? "").toLowerCase();
          return uname.includes("jdoe") ? { id: "u123" } : { error: "user not found" };
        }
        if (name === "get_balance") {
          return args.id === "u123" ? { balance: 450 } : { error: "unknown account id" };
        }
        return { error: `unknown tool: ${name}` };
      },
      validate: (trajectory) => {
        if (!trajectory.toolCallsMade.some((c) => c.name === "lookup_user")) {
          return { pass: false, reason: "never called lookup_user" };
        }
        if (!trajectory.toolCallsMade.some((c) => c.name === "get_balance" && c.args.id === "u123")) {
          return { pass: false, reason: "never called get_balance with the id returned by lookup_user" };
        }
        if (!/450/.test(trajectory.finalContent)) {
          return { pass: false, reason: `final answer didn't mention the balance (450): "${trajectory.finalContent}"` };
        }
        return { pass: true };
      },
    },
    {
      id: "react-error-recovery",
      kind: "agentic",
      category: "error-recovery",
      description: "Retries after a transient tool error instead of giving up or inventing an answer",
      messages: [{ role: "user", content: "Fetch note 'n1' and tell me exactly what it says." }],
      tools: [FETCH_NOTE_TOOL],
      maxTurns: 5,
      resolveTool: (() => {
        let callCount = 0;
        return async (name: string) => {
          callCount += 1;
          if (name !== "fetch_note") return { error: `unknown tool: ${name}` };
          if (callCount === 1) return { error: "transient failure, please retry" };
          return { content: "the launch code is orion-seven" };
        };
      })(),
      validate: (trajectory) => {
        if (trajectory.toolCallsMade.length < 2) {
          return { pass: false, reason: "gave up after the first tool error instead of retrying" };
        }
        if (!/orion-seven/i.test(trajectory.finalContent)) {
          return { pass: false, reason: `final answer didn't contain the note content: "${trajectory.finalContent}"` };
        }
        return { pass: true };
      },
    },
    {
      id: "escalate-on-hard-task",
      kind: "agentic",
      category: "escalation",
      description: "Self-escalates (calls escalate_task) on a task genuinely beyond a small model",
      messages: [
        {
          role: "user",
          content:
            "Design a distributed consensus algorithm resilient to Byzantine faults for a 7-node cluster. " +
            "Specify the exact state machine, message formats, and failure-handling logic.",
        },
      ],
      tools: [escalateTaskSchema],
      maxTurns: 3,
      resolveTool: async (name, args) => {
        if (name === "escalate_task") return { escalate: true, reason: args.reason ?? "" };
        return { error: `unknown tool: ${name}` };
      },
      validate: (trajectory) => {
        const called = trajectory.toolCallsMade.some((c) => c.name === "escalate_task");
        return called
          ? { pass: true }
          : { pass: false, reason: "did not call escalate_task on a task well beyond a small model's capability" };
      },
    },
    {
      id: "no-false-escalate-on-easy-task",
      kind: "agentic",
      category: "escalation",
      description: "Does not call escalate_task on a trivially easy task",
      messages: [{ role: "user", content: "What is 5 + 7? Answer with just the number." }],
      tools: [escalateTaskSchema],
      maxTurns: 3,
      resolveTool: async (name, args) => {
        if (name === "escalate_task") return { escalate: true, reason: args.reason ?? "" };
        return { error: `unknown tool: ${name}` };
      },
      validate: (trajectory) => {
        if (trajectory.toolCallsMade.some((c) => c.name === "escalate_task")) {
          return { pass: false, reason: "escalated an easy arithmetic question" };
        }
        if (!/12/.test(trajectory.finalContent)) {
          return { pass: false, reason: `expected "12" in the final answer, got "${trajectory.finalContent}"` };
        }
        return { pass: true };
      },
    },
  ];
}
