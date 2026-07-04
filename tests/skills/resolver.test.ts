import { resolveSkills, tokenize } from "../../src/skills/resolver";
import { SkillMeta } from "../../src/skills/types";

function meta(id: string, tags: string[], description = "", name = id): SkillMeta {
  return { id, name, description, tags, version: "0.0.0", scope: "workspace", dir: "", path: "" };
}

describe("tokenize", () => {
  it("lowercases, splits on non-word chars, and dedups", () => {
    expect(tokenize("Fix the Docker-Compose Build!")).toEqual(new Set(["fix", "the", "docker", "compose", "build"]));
    expect(tokenize("rails rails RAILS")).toEqual(new Set(["rails"]));
  });
});

describe("resolveSkills", () => {
  const catalog: SkillMeta[] = [
    meta("rails-api", ["rails", "api"], "Ruby on Rails REST API design"),
    meta("docker", ["docker", "compose"], "Container build and compose workflows"),
    meta("frontend", ["react", "typescript"], "React component design"),
  ];

  it("ranks by tag-weighted overlap, tag hits outrank description hits", () => {
    const results = resolveSkills("help me build a rails api", catalog);
    expect(results[0].meta.id).toBe("rails-api");
    expect(results[0].matchedTags).toEqual(["rails", "api"]);
  });

  it("excludes skills below minScore", () => {
    const results = resolveSkills("help me build a rails api", catalog, { minScore: 100 });
    expect(results).toEqual([]);
  });

  it("caps results at topN", () => {
    const results = resolveSkills("rails docker react", catalog, { topN: 1 });
    expect(results).toHaveLength(1);
  });

  it("breaks ties deterministically by id", () => {
    const tied: SkillMeta[] = [meta("zzz", ["shared"]), meta("aaa", ["shared"])];
    const results = resolveSkills("shared", tied);
    expect(results.map((r) => r.meta.id)).toEqual(["aaa", "zzz"]);
  });

  it("returns nothing for a prompt with no overlap", () => {
    expect(resolveSkills("completely unrelated text", catalog)).toEqual([]);
  });
});
