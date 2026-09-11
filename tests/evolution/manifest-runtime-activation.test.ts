import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { HarnessRegistry } from "@nemesis-oss/nexum-devagent/evolution/registry";
import { EvaluationMetrics } from "@nemesis-oss/nexum-devagent/evolution/types";
import {
  ManifestRuntimeActivationController,
  NEXUM_HARNESS_MANIFEST_PATH,
} from "@nemesis-oss/nexum-devagent/evolution/monitoring/manifest-runtime-activation";

const execFileAsync = promisify(execFile);

async function makeRepo(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "nexumact-"));
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "t@t"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "t"], { cwd: root });
  writeFileSync(join(root, "README.md"), "repo\n");
  await execFileAsync("git", ["add", "-A"], { cwd: root });
  await execFileAsync("git", ["commit", "-q", "-m", "init"], { cwd: root });
  return root;
}

function controllerFor(repoRoot: string, registry?: HarnessRegistry): ManifestRuntimeActivationController {
  return new ManifestRuntimeActivationController({ repoRoot, registry });
}

describe("ManifestRuntimeActivationController (v2.3.3 production activation)", () => {
  let repoRoot: string;
  let headSha: string;

  beforeEach(async () => {
    repoRoot = await makeRepo();
    headSha = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot })).stdout.trim();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  describe("activeHarness fallbacks", () => {
    it("reports 'unversioned' with no manifest and no registry", () => {
      expect(controllerFor(repoRoot).activeHarness()).toBe("unversioned");
    });

    it("falls back to the registry's promoted version", () => {
      const registry = new HarnessRegistry(":memory:");
      try {
        registry.saveVersion({
          id: "H0",
          commitSha: headSha,
          parentId: null,
          createdAt: 1,
          targetComponent: "execution",
          hypothesis: "base",
          metrics: {} as EvaluationMetrics,
          status: "promoted",
        });
        expect(controllerFor(repoRoot, registry).activeHarness()).toBe("H0");
      } finally {
        registry.close();
      }
    });

    it("the manifest pointer wins over the registry", async () => {
      const registry = new HarnessRegistry(":memory:");
      try {
        registry.saveVersion({
          id: "H0",
          commitSha: headSha,
          parentId: null,
          createdAt: 1,
          targetComponent: "execution",
          hypothesis: "base",
          metrics: {} as EvaluationMetrics,
          status: "promoted",
        });
        registry.saveVersion({
          id: "H1-candidate",
          commitSha: headSha,
          parentId: "H0",
          createdAt: 2,
          targetComponent: "execution",
          hypothesis: "candidate",
          metrics: {} as EvaluationMetrics,
          status: "validated",
        });
        const controller = controllerFor(repoRoot, registry);
        expect(controller.activeHarness()).toBe("H0");
        await controller.switchTo("H1-candidate");
        expect(controller.activeHarness()).toBe("H1-candidate");
      } finally {
        registry.close();
      }
    });
  });

  describe("switchTo", () => {
    it("activates a git-resolvable ref and records the full SHA atomically", async () => {
      const controller = controllerFor(repoRoot);
      await controller.switchTo("HEAD");
      const pointer = controller.readPointer();
      expect(pointer).not.toBeNull();
      expect(pointer!.id).toBe("HEAD");
      expect(pointer!.commitSha).toBe(headSha);
      expect(controller.activeHarness()).toBe("HEAD");
      // Atomic write: no tmp residue in the repo root.
      expect(readdirSync(repoRoot).filter((f) => f.includes(".tmp-"))).toEqual([]);
    });

    it("resolves registry harness ids to their recorded commit", async () => {
      const registry = new HarnessRegistry(":memory:");
      try {
        registry.saveVersion({
          id: "H1-candidate",
          commitSha: headSha,
          parentId: "H0",
          createdAt: 2,
          targetComponent: "execution",
          hypothesis: "candidate",
          metrics: {} as EvaluationMetrics,
          status: "validated",
        });
        const controller = controllerFor(repoRoot, registry);
        await controller.switchTo("H1-candidate");
        expect(controller.readPointer()!.commitSha).toBe(headSha);
      } finally {
        registry.close();
      }
    });

    it("refuses unknown harness ids without writing anything", async () => {
      writeFileSync(join(repoRoot, NEXUM_HARNESS_MANIFEST_PATH), JSON.stringify({ version: 1, policy: "keep" }));
      const before = readFileSync(join(repoRoot, NEXUM_HARNESS_MANIFEST_PATH), "utf8");
      await expect(controllerFor(repoRoot).switchTo("H-unknown")).rejects.toThrow(/unknown harness "H-unknown"/);
      expect(readFileSync(join(repoRoot, NEXUM_HARNESS_MANIFEST_PATH), "utf8")).toBe(before);
    });

    it("refuses registry rows whose commit is missing from the repository", async () => {
      const registry = new HarnessRegistry(":memory:");
      try {
        registry.saveVersion({
          id: "H-pruned",
          commitSha: "f".repeat(40),
          parentId: null,
          createdAt: 3,
          targetComponent: "execution",
          hypothesis: "gone",
          metrics: {} as EvaluationMetrics,
          status: "validated",
        });
        await expect(controllerFor(repoRoot, registry).switchTo("H-pruned")).rejects.toThrow(
          /missing from the repository/,
        );
        expect(controllerFor(repoRoot, registry).readPointer()).toBeNull();
      } finally {
        registry.close();
      }
    });

    it("preserves strategy-written manifest fields across activation", async () => {
      const manifestPath = join(repoRoot, NEXUM_HARNESS_MANIFEST_PATH);
      writeFileSync(
        manifestPath,
        JSON.stringify({ version: 1, targetId: "t-1", capability: "tool_utilization", rationale: "keep me" }),
      );
      const controller = controllerFor(repoRoot);
      await controller.switchTo("HEAD");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      expect(manifest.targetId).toBe("t-1");
      expect(manifest.capability).toBe("tool_utilization");
      expect(manifest.rationale).toBe("keep me");
      expect((manifest.activeHarness as { id: string }).id).toBe("HEAD");
    });

    it("fails closed on a corrupt manifest instead of clobbering it", async () => {
      const manifestPath = join(repoRoot, NEXUM_HARNESS_MANIFEST_PATH);
      writeFileSync(manifestPath, "{ not valid json");
      await expect(controllerFor(repoRoot).switchTo("HEAD")).rejects.toThrow();
      expect(readFileSync(manifestPath, "utf8")).toBe("{ not valid json");
    });

    it("honors the injected now() for pointer timestamps", async () => {
      const controller = new ManifestRuntimeActivationController({ repoRoot, now: () => 1234 });
      await controller.switchTo("HEAD");
      const pointer = controller.readPointer();
      expect(pointer!.id).toBe("HEAD");
      expect(pointer!.commitSha).toBe(headSha);
      expect(pointer!.activatedAt).toBe(1234);
    });
  });

  describe("harnessHealth", () => {
    it("is true for a resolvable ref and false for a bogus one", async () => {
      const controller = controllerFor(repoRoot);
      await expect(controller.harnessHealth("HEAD")).resolves.toBe(true);
      await expect(controller.harnessHealth("f".repeat(40))).resolves.toBe(false);
      await expect(controller.harnessHealth("H-unknown")).resolves.toBe(false);
    });
  });

  describe("freeze", () => {
    it("marks and clears the freeze flag across switches", async () => {
      const controller = controllerFor(repoRoot);
      await controller.freeze();
      expect(controller.isFrozen()).toBe(true);
      // A successful switch is the unfreeze.
      await controller.switchTo("HEAD");
      expect(controller.isFrozen()).toBe(false);
      expect(controller.readPointer()!.id).toBe("HEAD");
    });
  });

  describe("default git runner integration", () => {
    it("works against the real repository without injections", async () => {
      const controller = controllerFor(repoRoot);
      await controller.switchTo("main").catch(() => controller.switchTo("master"));
      expect(existsSync(join(repoRoot, NEXUM_HARNESS_MANIFEST_PATH))).toBe(true);
      await expect(controller.harnessHealth(controller.activeHarness())).resolves.toBe(true);
    });
  });
});
