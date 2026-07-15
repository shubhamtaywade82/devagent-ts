import { Provider, Tier } from "./provider";

export type Capability = "coding" | "vision" | "reasoning" | "quick" | "tools";

export interface ModelInfo {
  name: string;
  tier: Tier;
  capabilities: Capability[];
}

// ponytail: name-substring heuristic, not real capability metadata (Ollama Cloud's
// /v1/models doesn't expose it). Upgrade to local `/api/show` capability flags per
// model if this misroutes in practice.
export function inferCapabilities(name: string): Capability[] {
  const n = name.toLowerCase();
  const caps: Capability[] = ["tools"];

  if (/(^|[^a-z])(vl|vision)([^a-z]|$)/.test(n)) caps.push("vision");
  if (/(r1|reason|thinking)/.test(n)) caps.push("reasoning");
  if (/(0\.5b|1b|2b|3b|4b|nano|mini|hermes|opencode)/.test(n)) caps.push("quick");
  if (!caps.includes("vision") && !caps.includes("reasoning")) caps.push("coding");

  return caps;
}

function namesFromLocalTags(data: unknown): string[] {
  const models = (data as { models?: Array<{ name?: string; model?: string }> } | undefined)?.models ?? [];
  return models.map((m) => m.name ?? m.model).filter((n): n is string => !!n);
}

function namesFromCloudModels(data: unknown): string[] {
  const items = (data as { data?: Array<{ id?: string }> } | undefined)?.data ?? [];
  return items.map((m) => m.id).filter((n): n is string => !!n);
}

export class ModelCatalog {
  private models: ModelInfo[] = [];

  constructor(
    private readonly local?: Provider,
    private readonly cloud?: Provider,
  ) {}

  async refresh(): Promise<ModelInfo[]> {
    const results: ModelInfo[] = [];

    if (this.local) {
      try {
        const data = await this.local.availableModels();
        for (const name of namesFromLocalTags(data)) {
          results.push({ name, tier: "local", capabilities: inferCapabilities(name) });
        }
      } catch {
        // local Ollama not running — leave local models empty
      }
    }

    if (this.cloud) {
      try {
        const data = await this.cloud.availableModels();
        for (const name of namesFromCloudModels(data)) {
          results.push({ name, tier: "cloud", capabilities: inferCapabilities(name) });
        }
      } catch {
        // no cloud API key / unreachable — leave cloud models empty
      }
    }

    this.models = results;
    return results;
  }

  all(): ModelInfo[] {
    return this.models;
  }

  // Local-first: local candidates before cloud candidates.
  modelsFor(capability: Capability): ModelInfo[] {
    return this.models
      .filter((m) => m.capabilities.includes(capability))
      .sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "local" ? -1 : 1));
  }
}
