import * as readline from "node:readline";
import { CliConfig, loadConfig } from "./config";
import { Agent } from "./agent";
import { buildRegistry, buildSummaryMarkdown } from "./context";

export async function startRepl(opts?: { config?: Partial<CliConfig> }): Promise<void> {
  const cfg = { ...loadConfig(), ...(opts?.config ?? {}) };
  const registry = buildRegistry(cfg.workspaceRoot);
  const agent = new Agent({ config: cfg });

  const wsSummary = buildSummaryMarkdown(cfg.workspaceRoot);
  const systemNote = [
    `Model: ${cfg.model}`,
    `Workspace: ${cfg.workspaceRoot}`,
    cfg.host ? `Host: ${cfg.host}` : `Host: default local Ollama`,
    cfg.shellImage ? `Shell image: ${cfg.shellImage}` : "",
    "",
    wsSummary,
    "",
    cfg.systemPrompt,
    "",
    "Tools: " + [...registry.schemas()].map((s) => s.function.name).join(", "),
    "",
    "Type a task. /exit or Ctrl-C to quit.",
  ]
    .filter(Boolean)
    .join("\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  console.log(systemNote);
  rl.prompt(true);

  rl.on("line", async (line) => {
    const text = line.trim();
    if (!text) {
      rl.prompt();
      return;
    }
    if (text === "/exit" || text === "/quit") {
      rl.close();
      return;
    }
    if (text === "/clear") {
      rl.prompt();
      return;
    }

    let replied = false;
    try {
      const answer = await agent.runUserMessage(text);
      console.log("\n" + answer + "\n");
      replied = true;
    } catch (e) {
      const err = e as Error;
      console.error(`\nAgent error: ${err.message}\n`);
    }

    if (!replied) {
      console.log();
    }
    rl.prompt(true);
  });

  rl.on("close", () => {
    console.log("\nBye.");
    process.exit(0);
  });

  rl.on("SIGINT", () => {
    rl.close();
  });
}
