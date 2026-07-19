import type { OllamaToolSchema } from "../provider/provider.js";
import type { LocalTaskType, LocalOutputType } from "../provider/local-worker.js";

export interface DelegateToolArgs {
  task_type: LocalTaskType;
  prompt: string;
  expected_output: LocalOutputType;
  examples?: Array<{ input: string; output: string }>;
}

/**
 * Tool schema exposed to the cloud (orchestrator) model, allowing it to
 * delegate simple, stateless coding tasks to the local worker model.
 *
 * The cloud model calls this tool when it wants to generate boilerplate,
 * TypeScript interfaces, regex patterns, test skeletons, or parse logs
 * without spending cloud tokens on deterministic generation.
 */
export const DELEGATE_TO_LOCAL_TOOL: OllamaToolSchema = {
  type: "function",
  function: {
    name: "delegate_to_local",
    description: [
      "Delegates a simple, stateless coding task to a fast local model (MiniCPM5).",
      "USE for: TypeScript interface generation, regex patterns, Jest test skeletons, data format conversion, log/error extraction.",
      "DO NOT use for: complex logic, debugging, multi-step reasoning, framework APIs, or anything requiring cross-file context.",
      "If this tool returns { success: false }, handle the task yourself — do not call it again.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        task_type: {
          type: "string",
          enum: ["ts_interface", "regex", "parse", "format", "test_skeleton", "boilerplate"],
          description: "Category of the delegated task.",
        },
        prompt: {
          type: "string",
          description:
            "Explicit, self-contained prompt for the local model. Include exact inputs and expected output format. Keep under 400 tokens.",
        },
        expected_output: {
          type: "string",
          enum: ["typescript", "json", "regex", "text", "code"],
          description: "The output type the local model should produce.",
        },
        examples: {
          type: "array",
          description: "Optional few-shot examples to guide the local model.",
          items: {
            type: "object",
            properties: {
              input: { type: "string" },
              output: { type: "string" },
            },
            required: ["input", "output"],
          },
        },
      },
      required: ["task_type", "prompt", "expected_output"],
    },
  },
};

/** Parses the raw tool-call arguments from the cloud model into a typed object. */
export function parseDelegateArgs(raw: unknown): DelegateToolArgs {
  const args = raw as Record<string, unknown>;
  return {
    task_type: args.task_type as LocalTaskType,
    prompt: String(args.prompt ?? ""),
    expected_output: args.expected_output as LocalOutputType,
    examples: Array.isArray(args.examples)
      ? (args.examples as Array<{ input: string; output: string }>)
      : undefined,
  };
}

/**
 * System-prompt addendum injected when the LocalWorker is active.
 * Prepend this to the cloud model's system prompt.
 */
export const LOCAL_DELEGATION_SYSTEM_ADDENDUM = `
You have access to the \`delegate_to_local\` tool for generating boilerplate, TypeScript interfaces, regex patterns, test skeletons, and parsing logs.
Use it to save tokens on deterministic tasks. If it returns { "success": false }, handle the task yourself without calling it again.
Never delegate tasks that require reasoning, debugging, framework knowledge, or cross-file context.
`.trim();
