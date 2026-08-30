import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrate } from "../../src/cli/migrate.js";

const savedEnv = { ...process.env };

describe("nexum migrate — explicit migration command", () => {
  let root: string;

  let home: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nexum-migrate-"));
    home = mkdtempSync(join(tmpdir(), "nexum-migrate-home-"));
    process.env = { ...savedEnv };
    process.env.NEXUM_WORKSPACE = root;
    delete process.env.NEXUM_MODEL;
    delete process.env.DEVAGENT_MODEL;
    delete process.env.NEXUM_TIER;
    delete process.env.DEVAGENT_TIER;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it("migrates a legacy workspace and reports every copied entry", () => {
    const legacy = join(root, ".devagent");
    mkdirSync(join(legacy, "sessions"), { recursive: true });
    writeFileSync(join(legacy, "memory.db"), "mem");
    writeFileSync(join(legacy, "checkpoint.json"), "{}");
    writeFileSync(join(legacy, "sessions", "s1.json"), "{}");

    const report = runMigrate({ cwd: root, homeDir: home });

    expect(report.workspaceMigrated).toBe(true);
    expect(report.workspaceRoot).toBe(root);
    expect(report.entries.find((e) => e.name === "memory.db")?.status).toBe("copied");
    expect(report.entries.find((e) => e.name === "checkpoint.json")?.status).toBe("copied");
    expect(report.failed).toHaveLength(0);
    expect(existsSync(join(root, ".nexum", "memory.db"))).toBe(true);
    expect(existsSync(join(root, ".devagent", "memory.db"))).toBe(true); // original preserved
  });

  it("lists active DEVAGENT_* variables in the report", () => {
    process.env.DEVAGENT_MODEL = "legacy";
    process.env.DEVAGENT_TIER = "local";
    const report = runMigrate({ cwd: root, homeDir: home });
    expect(report.legacyEnvVariables).toContain("DEVAGENT_MODEL");
    expect(report.legacyEnvVariables).toContain("DEVAGENT_TIER");
  });

  it("is a clean no-op on a Nexum-native workspace", () => {
    const report = runMigrate({ cwd: root, homeDir: home });
    expect(report.noLegacyWorkspace).toBe(true);
    expect(report.workspaceMigrated).toBe(false);
    expect(report.failed).toHaveLength(0);
  });

  it("second run is idempotent (already migrated)", () => {
    mkdirSync(join(root, ".devagent"), { recursive: true });
    writeFileSync(join(root, ".devagent", "memory.db"), "mem");
    const first = runMigrate({ cwd: root, homeDir: home });
    expect(first.workspaceMigrated).toBe(true);
    const second = runMigrate({ cwd: root, homeDir: home });
    expect(second.alreadyMigrated).toBe(true);
    expect(second.workspaceMigrated).toBe(false);
  });
});
