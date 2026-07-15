import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { loadConfig } from "../../src/cli/config";

describe("loadConfig apiKeys pool", () => {
  const originalEnv = { ...process.env };
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "config-test-"));
    process.env.DEVAGENT_WORKSPACE = workspaceRoot;
    delete process.env.OLLAMA_API_KEY;
    delete process.env.OLLAMA_API_KEYS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("is undefined when no keys are configured anywhere", () => {
    expect(loadConfig().apiKeys).toBeUndefined();
  });

  it("puts OLLAMA_API_KEY first in the pool", () => {
    process.env.OLLAMA_API_KEY = "primary_key";
    expect(loadConfig().apiKeys).toEqual(["primary_key"]);
  });

  it("appends comma-separated OLLAMA_API_KEYS after the primary key", () => {
    process.env.OLLAMA_API_KEY = "primary_key";
    process.env.OLLAMA_API_KEYS = "second_key, third_key";
    expect(loadConfig().apiKeys).toEqual(["primary_key", "second_key", "third_key"]);
  });

  it("merges in keys from the workspace config file and dedupes", () => {
    process.env.OLLAMA_API_KEY = "primary_key";
    mkdirSync(join(workspaceRoot, ".devagent"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, ".devagent", "config.json"),
      JSON.stringify({ apiKeys: ["primary_key", "file_key"] }),
    );

    expect(loadConfig().apiKeys).toEqual(["primary_key", "file_key"]);
  });
});
