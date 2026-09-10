import { ToolCatalog } from "../../src/kernel/tools/tool-catalog.js";
import {
  DefaultToolGateway,
  canonicalToolName,
  decodeRawArguments,
  normalizeToolArgs,
  validateAgainstSchema,
} from "../../src/kernel/tools/tool-gateway.js";
import { ToolDefinition, ToolResult } from "../../src/kernel/tools/tool-definition.js";
import { RulePolicyEngine } from "../../src/kernel/policy/policy-engine.js";
import { Tool } from "../../src/tools/tool.js";

function def(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: "echo",
    description: "echoes input",
    inputSchema: { type: "object", properties: {} },
    capabilities: ["testing"],
    pack: "test",
    tags: [],
    risk: "read",
    sideEffects: { filesystem: false, process: false, network: false, externalMutation: false, financial: false },
    execution: { timeoutMs: 5_000, concurrency: 1, idempotent: true, reversible: true },
    policy: { confirmation: "never" },
    ...overrides,
  };
}

const TEXT_SCHEMA = { type: "object", properties: { text: { type: "string" } }, required: ["text"] };

class LegacyGreetTool extends Tool {
  get name(): string {
    return "greet";
  }
  get description(): string {
    return "greets";
  }
  get parameters(): Record<string, unknown> {
    return { type: "object", properties: { name: { type: "string" } }, required: ["name"] };
  }
  async call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    return { hello: String(args.name) };
  }
}

describe("canonicalToolName", () => {
  it("strips provider prefixes and maps aliases", () => {
    expect(canonicalToolName("functions.read_file")).toBe("read_file");
    expect(canonicalToolName("ls")).toBe("list_dir");
    expect(canonicalToolName("bash")).toBe("run_shell");
    expect(canonicalToolName("read_file")).toBe("read_file");
  });
});

describe("normalizeToolArgs", () => {
  const d = def({ inputSchema: TEXT_SCHEMA });
  it("maps positional arrays onto schema properties", () => {
    expect(normalizeToolArgs(d, ["hello"])).toEqual({ text: "hello" });
  });
  it("maps numeric-key objects onto schema properties", () => {
    expect(normalizeToolArgs(d, { 0: "hello" })).toEqual({ text: "hello" });
  });
  it("passes objects through", () => {
    expect(normalizeToolArgs(d, { text: "hi" })).toEqual({ text: "hi" });
  });
});

describe("decodeRawArguments", () => {
  it("parses JSON strings", () => {
    const { args, parseError } = decodeRawArguments('{"text":"hi"}');
    expect(parseError).toBeNull();
    expect(args).toEqual({ text: "hi" });
  });
  it("repairs malformed JSON into positional parts", () => {
    const { args, parseError } = decodeRawArguments("hello, world");
    expect(parseError).not.toBeNull();
    expect(args).toEqual(["hello", "world"]);
  });
});

describe("validateAgainstSchema", () => {
  it("reports missing required args and type mismatches", () => {
    const problems = validateAgainstSchema({ text: 42 }, TEXT_SCHEMA);
    expect(problems).toEqual(['argument "text" expected string, got number']);
    const missing = validateAgainstSchema({}, TEXT_SCHEMA);
    expect(missing).toEqual(['missing required argument "text"']);
  });
});

describe("DefaultToolGateway", () => {
  const makeCatalog = () => {
    const catalog = new ToolCatalog();
    catalog.register(def({ inputSchema: TEXT_SCHEMA }), async (args) => ({ echoed: args.text }));
    catalog.register(
      def({ id: "boomer", policy: { confirmation: "never" }, risk: "read" }),
      async () => {
        throw new Error("boom");
      },
    );
    catalog.register(
      def({ id: "slow", execution: { timeoutMs: 30, concurrency: 1, idempotent: true, reversible: true } }),
      async () => {
        await new Promise((r) => setTimeout(r, 250));
        return { done: true };
      },
    );
    return catalog;
  };

  it("executes through the full happy pipeline", async () => {
    const gateway = new DefaultToolGateway({ catalog: makeCatalog() });
    const result = await gateway.invoke("echo", { text: "hi" });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ echoed: "hi" });
  });

  it("returns UnknownTool failure for unregistered tools", async () => {
    const gateway = new DefaultToolGateway({ catalog: makeCatalog() });
    const result = await gateway.invoke("nope", {});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UnknownTool");
    expect(result.data.message).toContain("Available tools");
  });

  it("enforces schema validation in strict mode but not in off mode", async () => {
    const strict = new DefaultToolGateway({ catalog: makeCatalog(), validation: "strict" });
    const strictResult = await strict.invoke("echo", {});
    expect(strictResult.error?.code).toBe("ValidationError");

    const off = new DefaultToolGateway({ catalog: makeCatalog(), validation: "off" });
    const offResult = await off.invoke("echo", {});
    expect(offResult.ok).toBe(true);
    expect(offResult.data).toEqual({ echoed: undefined });
  });

  it("maps policy denials to structured failures", async () => {
    const policy = new RulePolicyEngine({ deniedToolIds: ["echo"] });
    const gateway = new DefaultToolGateway({ catalog: makeCatalog(), policyEngine: policy });
    const result = await gateway.invoke("echo", { text: "hi" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("PolicyDenied");
    expect(result.data.message).toContain("denied by policy");
  });

  it("surfaces ConfirmationRequired when the policy demands it", async () => {
    const catalog = makeCatalog();
    catalog.register(
      def({
        id: "trade",
        risk: "critical",
        sideEffects: { filesystem: false, process: false, network: true, externalMutation: true, financial: true },
        policy: { confirmation: "optional" },
        inputSchema: { type: "object", properties: {} },
      }),
      async () => ({ placed: true }),
    );
    const gateway = new DefaultToolGateway({ catalog, policyEngine: new RulePolicyEngine() });
    const result = await gateway.invoke("trade", {});
    expect(result.error?.code).toBe("ConfirmationRequired");
    // ...and proceeds when the run is explicitly unattended.
    const unattended = await gateway.invoke("trade", {}, { unattended: true });
    expect(unattended.ok).toBe(true);
    expect(unattended.data).toEqual({ placed: true });
  });

  it("times out long-running tools", async () => {
    const gateway = new DefaultToolGateway({ catalog: makeCatalog() });
    const result = await gateway.invoke("slow", {});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("Timeout");
  });

  it("wraps handler exceptions as structured failures", async () => {
    const gateway = new DefaultToolGateway({ catalog: makeCatalog() });
    const result = await gateway.invoke("boomer", {});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("Error");
    expect(result.data.message).toBe("boom");
  });

  it("honors abort signals", async () => {
    const controller = new AbortController();
    controller.abort();
    const gateway = new DefaultToolGateway({ catalog: makeCatalog() });
    const result = await gateway.invoke("echo", { text: "hi" }, { signal: controller.signal });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("GateAbortedError");
  });

  it("registers legacy tools with inferred risk metadata", async () => {
    const catalog = new ToolCatalog();
    catalog.registerLegacy(new LegacyGreetTool(), "Filesystem");
    const gateway = new DefaultToolGateway({ catalog });
    const result = await gateway.invoke("greet", { name: "nexum" });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ hello: "nexum" });
    expect(catalog.definition("greet")?.pack).toBe("Filesystem");
  });

  it("discover filters by capability", () => {
    const gateway = new DefaultToolGateway({ catalog: makeCatalog() });
    expect(gateway.discover(["testing"]).map((d) => d.id)).toContain("echo");
    expect(gateway.discover(["no-such"]).map((d) => d.id)).toEqual([]);
  });
});
