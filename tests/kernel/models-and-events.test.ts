import { ModelCapabilityRegistry } from "../../src/kernel/models/model-capability-registry.js";
import { profileFromLegacy, defaultConstraints } from "../../src/kernel/models/model-profile.js";
import { familyOf, filteringSink, isDomainEvent, isExecutionEvent, isPresentationEvent } from "../../src/kernel/events/families.js";
import type { ModelInfo } from "../../src/provider/catalog.js";
import type { RuntimeEvent } from "../../src/runtime/events.js";

describe("ModelCapabilityRegistry", () => {
  const legacy: ModelInfo[] = [
    { name: "qwen2.5-coder:32b", tier: "local", capabilities: ["tools", "coding"] },
    { name: "qwq", tier: "local", capabilities: ["tools", "reasoning"] },
    { name: "minicpm5", tier: "local", capabilities: ["tools", "quick"] },
    { name: "gpt-oss:120b", tier: "cloud", capabilities: ["tools", "reasoning", "agentic"] },
  ];

  it("syncs legacy ModelInfo into profiles", () => {
    const registry = new ModelCapabilityRegistry().syncFromLegacy(legacy);
    expect(registry.size()).toBe(4);
    const profile = registry.get("qwq")!;
    expect(profile.tier).toBe("local");
    expect(profile.capabilities.toolCalling).toBe(true);
    expect(profile.capabilities.reasoning).toBe(1);
    expect(profile.capabilities.vision).toBe(0);
    expect(profile.legacyCapabilities).toContain("reasoning");
  });

  it("queries by tier, tool calling, and latency class", () => {
    const registry = new ModelCapabilityRegistry().syncFromLegacy(legacy);
    expect(registry.query({ tier: "cloud" }).map((p) => p.id)).toEqual(["gpt-oss:120b"]);
    expect(registry.query({ toolCalling: true })).toHaveLength(4);
    expect(registry.query({ maxLatencyClass: "fast" }).map((p) => p.id)).toEqual(["minicpm5"]);
  });

  it("orders local-first by default and preserves legacy capability bridging", () => {
    const registry = new ModelCapabilityRegistry().syncFromLegacy(legacy);
    const ordered = registry.query({ tier: undefined });
    expect(ordered[0].tier).toBe("local");
    expect(registry.withLegacyCapability("reasoning").map((p) => p.id)).toEqual(["qwq", "gpt-oss:120b"]);
  });

  it("estimates cost from profile metadata", () => {
    const registry = new ModelCapabilityRegistry();
    registry.upsert({
      id: "cloud-model",
      provider: "ollama-cloud",
      tier: "cloud",
      capabilities: {
        reasoning: 1,
        coding: 1,
        vision: 0,
        toolCalling: true,
        structuredOutput: true,
        streaming: true,
      },
      constraints: defaultConstraints(),
      cost: { input: 2, output: 4 },
    });
    // 1M input tokens at $2/M + 0.5M output at $4/M = $4
    expect(registry.estimateCostUsd("cloud-model", 1_000_000, 500_000)).toBe(4);
    expect(registry.estimateCostUsd("unknown", 1, 1)).toBeUndefined();
  });

  it("profileFromLegacy marks quick models as fast", () => {
    const profile = profileFromLegacy({ name: "minicpm5", tier: "local", capabilities: ["quick"] });
    expect(profile.constraints.latencyClass).toBe("fast");
  });
});

describe("event families", () => {
  it("classifies execution, domain, and presentation events", () => {
    const execution: RuntimeEvent = { type: "tool.completed", id: "1", result: {} };
    const domain: RuntimeEvent = { type: "conversation.message", role: "user", text: "hi" };
    const presentation: RuntimeEvent = { type: "theme.changed", theme: "midnight" };
    expect(isExecutionEvent(execution)).toBe(true);
    expect(isDomainEvent(domain)).toBe(true);
    expect(isPresentationEvent(presentation)).toBe(true);
    expect(familyOf({ type: "rails.index", status: "ready" } as RuntimeEvent)).toBe("domain");
    expect(familyOf({ type: "notification", text: "x", kind: "info" } as RuntimeEvent)).toBe("presentation");
  });

  it("filteringSink forwards only the requested families", () => {
    const seen: string[] = [];
    const sink = filteringSink({ publish: (e) => seen.push(e.type) }, ["execution"]);
    sink.publish({ type: "tool.started", id: "1", name: "ls", args: {} } as RuntimeEvent);
    sink.publish({ type: "theme.changed", theme: "default" } as RuntimeEvent);
    sink.publish({ type: "task.created", task: { id: "t", title: "T", status: "queued", dependencies: [] } } as RuntimeEvent);
    expect(seen).toEqual(["tool.started", "task.created"]);
  });
});
