import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectWorkspaceDocSources, detectWorkspaceKinds } from "../../src/docs/workspace-detect.js";

async function tempWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "docs-workspace-"));
}

describe("detectWorkspaceKinds / detectWorkspaceDocSources", () => {
  it("detects a plain Node.js workspace from package.json", async () => {
    const dir = await tempWorkspace();
    await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: {} }));

    expect(detectWorkspaceKinds(dir)).toEqual(["node"]);
    expect(detectWorkspaceDocSources(dir)).toEqual(["node", "javascript"]);
  });

  it("detects TypeScript via tsconfig.json even without a typescript dependency", async () => {
    const dir = await tempWorkspace();
    await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: {} }));
    await writeFile(join(dir, "tsconfig.json"), "{}");

    expect(detectWorkspaceKinds(dir)).toEqual(["typescript", "node"]);
    expect(detectWorkspaceDocSources(dir)).toEqual(["typescript", "javascript", "node"]);
  });

  it("detects React from package.json dependencies", async () => {
    const dir = await tempWorkspace();
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" } }),
    );

    expect(detectWorkspaceKinds(dir)).toEqual(["react", "node"]);
    expect(detectWorkspaceDocSources(dir)).toEqual(["react", "javascript", "html", "css", "node"]);
  });

  it("detects Rails from Gemfile + config/application.rb", async () => {
    const dir = await tempWorkspace();
    await writeFile(join(dir, "Gemfile"), 'source "https://rubygems.org"\ngem "rails", "7.1.0"\n');
    await mkdir(join(dir, "config"), { recursive: true });
    await writeFile(
      join(dir, "config", "application.rb"),
      "module App\n  class Application < Rails::Application\n  end\nend\n",
    );

    expect(detectWorkspaceKinds(dir)).toEqual(["rails"]);
    expect(detectWorkspaceDocSources(dir)).toEqual(["rails", "ruby"]);
  });

  it("detects plain Ruby (no Rails::Application) as ruby only", async () => {
    const dir = await tempWorkspace();
    await writeFile(join(dir, "Gemfile"), 'source "https://rubygems.org"\ngem "rake"\n');

    expect(detectWorkspaceKinds(dir)).toEqual(["ruby"]);
    expect(detectWorkspaceDocSources(dir)).toEqual(["ruby"]);
  });

  it("detects Python via pyproject.toml", async () => {
    const dir = await tempWorkspace();
    await writeFile(join(dir, "pyproject.toml"), "[project]\nname = 'app'\n");

    expect(detectWorkspaceKinds(dir)).toEqual(["python"]);
    expect(detectWorkspaceDocSources(dir)).toEqual(["python"]);
  });

  it("detects Django when manage.py is present alongside Python markers", async () => {
    const dir = await tempWorkspace();
    await writeFile(join(dir, "requirements.txt"), "django\n");
    await writeFile(join(dir, "manage.py"), "#!/usr/bin/env python\n");

    expect(detectWorkspaceKinds(dir)).toEqual(["django", "python"]);
    expect(detectWorkspaceDocSources(dir)).toEqual(["django", "python"]);
  });

  it("detects Go and Rust from their manifest files", async () => {
    const goDir = await tempWorkspace();
    await writeFile(join(goDir, "go.mod"), "module example.com/app\n");
    expect(detectWorkspaceKinds(goDir)).toEqual(["go"]);

    const rustDir = await tempWorkspace();
    await writeFile(join(rustDir, "Cargo.toml"), '[package]\nname = "app"\n');
    expect(detectWorkspaceKinds(rustDir)).toEqual(["rust"]);
  });

  it("returns an empty list for a workspace with no recognizable markers", async () => {
    const dir = await tempWorkspace();
    expect(detectWorkspaceKinds(dir)).toEqual([]);
    expect(detectWorkspaceDocSources(dir)).toEqual([]);
  });
});
