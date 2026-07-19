import { Tool } from "./tool.js";
import { LocalWorker, LocalTask, LocalTaskType, LocalOutputType } from "../provider/local-worker.js";

/**
 * Exposed to the primary/cloud model once a turn has escalated, letting it
 * delegate simple, stateless boilerplate back down to the local quick model
 * instead of spending primary-model tokens generating it itself.
 */
export class DelegateToLocalTool extends Tool {
  constructor(private readonly worker: LocalWorker) {
    super();
  }

  get name(): string {
    return "delegate_to_local";
  }

  get description(): string {
    return [
      "Delegates a simple, stateless coding task to a fast local model.",
      "USE for: TypeScript interface generation, regex patterns, Jest test skeletons, data format conversion, log/error extraction.",
      "DO NOT use for: complex logic, debugging, multi-step reasoning, framework APIs, or anything requiring cross-file context.",
      "If this tool returns { success: false }, handle the task yourself — do not call it again.",
    ].join(" ");
  }

  get tags(): string[] {
    return ["meta", "delegation"];
  }

  get parameters(): Record<string, unknown> {
    return {
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
            properties: { input: { type: "string" }, output: { type: "string" } },
            required: ["input", "output"],
          },
        },
      },
      required: ["task_type", "prompt", "expected_output"],
    };
  }

  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const task: LocalTask = {
      type: args.task_type as LocalTaskType,
      prompt: String(args.prompt ?? ""),
      expectedOutput: args.expected_output as LocalOutputType,
      examples: Array.isArray(args.examples)
        ? (args.examples as Array<{ input: string; output: string }>)
        : undefined,
    };

    const result = await this.worker.execute(task);
    if (result.success) {
      return { success: true, output: result.output };
    }
    return { success: false, error: result.error ?? result.validationError ?? "local generation failed" };
  }
}

/** System-prompt addendum injected once a turn escalates, telling the primary
 * model it can delegate boilerplate back down instead of writing it itself. */
export const LOCAL_DELEGATION_SYSTEM_ADDENDUM = `
You have access to the \`delegate_to_local\` tool for generating boilerplate, TypeScript interfaces, regex patterns, test skeletons, and parsing logs.
Use it to save tokens on deterministic tasks. If it returns { "success": false }, handle the task yourself without calling it again.
Never delegate tasks that require reasoning, debugging, framework knowledge, or cross-file context.
`.trim();
