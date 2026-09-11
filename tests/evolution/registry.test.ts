import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessRegistry } from "@nemesis-oss/nexum-devagent/evolution/registry";
import { EvaluationMetrics, HarnessVersion } from "@nemesis-oss/nexum-devagent/evolution/types";

const sampleMetrics: EvaluationMetrics = {
  capability: { taskSuccessRate: 0.75, verificationPassRate: 0.8 },
  reliability: { toolErrorRate: 0.1, falseSuccessRate: 0.05, loopAbortRate: 0.02 },
  efficiency: { avgTokens: 12000, avgLatencyMs: 3500 },
  generalization: { heldOutScore: 0.7, transferScore: 0.68 },
};

describe("HarnessRegistry", () => {
  let tmpDir: string;
  let registry: HarnessRegistry;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "reg-test-"));
    registry = new HarnessRegistry(join(tmpDir, "registry.db"));
  });

  afterEach(async () => {
    registry.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("saves and retrieves a harness version", () => {
    const v0: HarnessVersion = {
      id: "H0",
      commitSha: "sha-000",
      parentId: null,
      createdAt: 1000,
      targetComponent: "execution",
      hypothesis: "Baseline",
      metrics: sampleMetrics,
      status: "promoted",
    };

    registry.saveVersion(v0);
    const fetched = registry.getVersion("H0");
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe("H0");
    expect(fetched!.commitSha).toBe("sha-000");
    expect(fetched!.status).toBe("promoted");
  });

  it("lists versions in chronological order and resolves active version", () => {
    const v0: HarnessVersion = {
      id: "H0",
      commitSha: "sha-0",
      parentId: null,
      createdAt: 1000,
      targetComponent: "execution",
      hypothesis: "Baseline",
      metrics: sampleMetrics,
      status: "promoted",
    };
    const v1: HarnessVersion = {
      id: "H1",
      commitSha: "sha-1",
      parentId: "H0",
      createdAt: 2000,
      targetComponent: "verification",
      hypothesis: "Add verification gate",
      metrics: sampleMetrics,
      status: "candidate",
    };

    registry.saveVersion(v0);
    registry.saveVersion(v1);

    const all = registry.listVersions();
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe("H0");
    expect(all[1].id).toBe("H1");

    expect(registry.getActiveVersion()?.id).toBe("H0");

    registry.promoteVersion("H1");
    expect(registry.getActiveVersion()?.id).toBe("H1");
  });

  it("rolls back to an earlier version", () => {
    const v0: HarnessVersion = {
      id: "H0",
      commitSha: "sha-0",
      parentId: null,
      createdAt: 1000,
      targetComponent: "execution",
      hypothesis: "Baseline",
      metrics: sampleMetrics,
      status: "promoted",
    };
    const v1: HarnessVersion = {
      id: "H1",
      commitSha: "sha-1",
      parentId: "H0",
      createdAt: 2000,
      targetComponent: "verification",
      hypothesis: "Faulty experiment",
      metrics: sampleMetrics,
      status: "promoted",
    };

    registry.saveVersion(v0);
    registry.saveVersion(v1);
    expect(registry.getActiveVersion()?.id).toBe("H1");

    registry.rollbackTo("H0");
    expect(registry.getActiveVersion()?.id).toBe("H0");
    expect(registry.getVersion("H1")?.status).toBe("rolled_back");
  });
});
