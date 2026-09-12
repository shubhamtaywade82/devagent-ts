/**
 * CONTRACT TESTS — ModelRouter (scored routing, review items 17, 18, 37).
 *
 * Verifies: dimension scoring beats name matching, hard constraints filter,
 * ModelSelection separation from transport, config-driven preferences.
 */

import { ModelCapabilityRegistry } from "../../src/models/profiles/model-capability-registry.js";
import { defaultConstraints } from "../../src/models/profiles/model-profile.js";
import { ScoredModelRouter } from "../../src/models/router/scored-router.js";
import type { ModelProfile } from "../../src/models/profiles/model-profile.js";
import { loadModelPreferences } from "../../src/models/catalog-data.js";

function profile(
  id: string,
  tier: "local" | "cloud",
  caps: Partial<ModelProfile["capabilities"]>,
  constraints?: Partial<ModelProfile["constraints"]>,
): ModelProfile {
  return {
    id,
    provider: tier === "local" ? "ollama" : "ollama-cloud",
    tier,
    capabilities: {
      reasoning: caps.reasoning ?? 0,
      coding: caps.coding ?? 0,
      vision: caps.vision ?? 0,
      toolCalling: caps.toolCalling ?? 0,
      structuredOutput: caps.structuredOutput ?? 0,
      streaming: true,
    },
    constraints: defaultConstraints(constraints),
    legacyCapabilities: [],
  };
}

describe("ModelRouter contract (scored routing)", () => {
  it("ranks by dimension scores, not curated names (item 17)", () => {
    const registry = new ModelCapabilityRegistry()
      .upsert(profile("curated-favorite", "local", { reasoning: 0.3 }))
      .upsert(profile("unknown-name-high-score", "local", { reasoning: 0.9 }));
    const router = new ScoredModelRouter({ registry });
    const ranked = router.select({ capability: "reasoning" });
    expect(ranked[0].model).toBe("unknown-name-high-score");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[0].reasons.some((r) => r.dimension === "reasoning")).toBe(true);
  });

  it("context capacity uses a log scale and gates by minContextTokens (item 17)", () => {
    const registry = new ModelCapabilityRegistry()
      .upsert(profile("small", "local", {}, { contextWindow: 4_096 }))
      .upsert(profile("large", "local", {}, { contextWindow: 262_144 }));
    const router = new ScoredModelRouter({ registry });
    const constrained = router.select({ constraints: { minContextTokens: 100_000 } });
    expect(constrained.map((s) => s.model)).toEqual(["large"]);
    // unconstrained: larger context scores higher on the capacity dimension
    const open = router.select({});
    expect(open[0].model).toBe("large");
  });

  it("latency + cost constraints filter candidates (item 17)", () => {
    const registry = new ModelCapabilityRegistry()
      .upsert(profile("slow-cheap", "local", { coding: 1 }, { latencyClass: "slow" }))
      .upsert(profile("fast-pricey", "cloud", { coding: 1 }, { latencyClass: "fast" }));
    const router = new ScoredModelRouter({ registry });
    const fast = router.select({ constraints: { maxLatencyClass: "fast" } });
    expect(fast.map((s) => s.model)).toEqual(["fast-pricey"]);
  });

  it("local-first bonus applies and tier filter is honored (item 17/18)", () => {
    const registry = new ModelCapabilityRegistry()
      .upsert(profile("cloud-strong", "cloud", { coding: 1 }))
      .upsert(profile("local-ok", "local", { coding: 0.95 }));
    const router = new ScoredModelRouter({ registry });
    const localFirst = router.select({ capability: "coding" });
    expect(localFirst[0].tier).toBe("local");
    const cloudOnly = router.select({ preferences: { tier: "cloud" } });
    expect(cloudOnly.every((s) => s.tier === "cloud")).toBe(true);
  });

  it("selection is transport-free: ModelSelection carries score/reasons, no execution (item 18)", () => {
    const registry = new ModelCapabilityRegistry().upsert(profile("m", "local", { toolCalling: 1 }));
    const router = new ScoredModelRouter({ registry });
    const selections = router.select({ capability: "agentic" });
    expect(selections.length).toBe(1);
    const s = selections[0];
    expect(s.model).toBe("m");
    expect(s.tier).toBe("local");
    expect(s.reasons.length).toBeGreaterThan(3);
    expect(s.profile).toBeDefined();
    // no transport reference anywhere on the selection
    expect((s as unknown as Record<string, unknown>).provider).toBeUndefined();
    expect((s as unknown as Record<string, unknown>).chat).toBeUndefined();
  });

  it("curated model preferences load from data/env/file, not code (item 35)", () => {
    const defaults = loadModelPreferences();
    expect(Array.isArray(defaults.coding)).toBe(true);
    const env = loadModelPreferences({ env: { NEXUM_MODEL_PREFS_CODING: "custom-a,custom-b" } });
    expect(env.coding).toEqual(["custom-a", "custom-b"]);
    const inline = loadModelPreferences({ inline: { reasoning: ["r1"] } });
    expect(inline.reasoning).toEqual(["r1"]);
  });
});
