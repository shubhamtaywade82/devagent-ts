import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "../src/cli/agent";

async function main() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "vision-routing-verify-"));
  const agent = new Agent({ config: { workspaceRoot, tier: "local", model: "qwen3.5:4b" } });

  agent.on("onStatus", (s) => console.log("[status]", s));

  console.log("=== real local Ollama catalog has no vision/reasoning model installed ===");
  console.log("primary model before:", agent.currentModel);

  await agent.runUserMessage("Look at this screenshot and tell me what's wrong with the button alignment");

  console.log("primary model after (should be unchanged — fell back, no vision model available):", agent.currentModel);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
