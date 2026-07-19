import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry } from "../tools/registry.js";
import { ReadFileTool } from "../tools/filesystem.js";
import { SearchCodeTool } from "../tools/search-tools.js";
import { AgenticBenchmarkCase } from "./types.js";

// Real end-to-end tool execution — not scripted mocks — against a throwaway
// workspace, so these cases exercise the actual Tool implementations
// (filesystem I/O, ripgrep-backed search) the real agent uses.
export async function buildExecutionCases(): Promise<AgenticBenchmarkCase[]> {
  const root = await mkdtemp(join(tmpdir(), "devagent-benchmark-"));
  await writeFile(join(root, "notes.txt"), "Project notes.\nThe secret code is 4471.\nEnd of notes.\n");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "auth.ts"), "// TODO: fix auth token refresh race condition\nexport function auth() {}\n");

  const readRegistry = new Registry().register(new ReadFileTool(root));
  const searchRegistry = new Registry().register(new SearchCodeTool(root));

  return [
    {
      id: "execution-real-read-file",
      kind: "agentic",
      category: "execution",
      description: "Reads a real file via the real ReadFileTool and reports its content correctly",
      messages: [{ role: "user", content: "Read the file notes.txt and tell me the secret code mentioned in it." }],
      tools: [new ReadFileTool(root).schema],
      maxTurns: 4,
      resolveTool: (name, args) => readRegistry.invoke(name, args),
      validate: (trajectory) => {
        if (!trajectory.toolCallsMade.some((c) => c.name === "read_file")) {
          return { pass: false, reason: "never called read_file" };
        }
        if (!/4471/.test(trajectory.finalContent)) {
          return { pass: false, reason: `final answer didn't contain the secret code (4471): "${trajectory.finalContent}"` };
        }
        return { pass: true };
      },
    },
    {
      id: "execution-real-search-code",
      kind: "agentic",
      category: "execution",
      description: "Finds a real TODO comment via the real SearchCodeTool (ripgrep-backed)",
      messages: [{ role: "user", content: "Search the codebase for TODO comments and tell me what the first one says." }],
      tools: [new SearchCodeTool(root).schema],
      maxTurns: 4,
      resolveTool: (name, args) => searchRegistry.invoke(name, args),
      validate: (trajectory) => {
        if (!trajectory.toolCallsMade.some((c) => c.name === "search_code")) {
          return { pass: false, reason: "never called search_code" };
        }
        if (!/auth/i.test(trajectory.finalContent)) {
          return { pass: false, reason: `final answer didn't mention the auth TODO: "${trajectory.finalContent}"` };
        }
        return { pass: true };
      },
    },
  ];
}
