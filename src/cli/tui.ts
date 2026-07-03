import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import ora from "ora";
import boxen from "boxen";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";

import { Agent } from "./agent";
import { CliConfig, loadConfig } from "./config";

// Setup marked terminal styling for premium aesthetics
marked.setOptions({
  renderer: new TerminalRenderer({
    code: chalk.yellow,
    blockquote: chalk.gray.italic,
    html: chalk.gray,
    heading: chalk.bold.cyan,
    firstHeading: chalk.bold.cyan,
    link: chalk.blue,
    href: chalk.blue.underline,
    listitem: (text: string) => ` • ${text}`,
    tab: 2,
  }) as any,
});

async function listModels(host: string | undefined): Promise<string[]> {
  const base = host ?? process.env.OLLAMA_HOST ?? "http://localhost:11434";
  try {
    const resp = await fetch(`${base}/api/tags`);
    if (!resp.ok) {
      return [];
    }
    const data = (await resp.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

export async function startTui(opts?: { config?: Partial<CliConfig> }): Promise<void> {
  const cfg = { ...loadConfig(), ...(opts?.config ?? {}) };
  const agent = new Agent({ config: cfg });

  // Pre-fetch models list for autocomplete support
  const modelsList = await listModels(cfg.host);

  // Render a high-fidelity startup banner
  const bannerText = [
    chalk.bold.magenta("⚡ DevAgent TS Ecosystem CLI ⚡"),
    "",
    `${chalk.bold("Model:")}      ${chalk.cyan(agent.currentModel)}`,
    `${chalk.bold("Workspace:")}  ${chalk.gray(cfg.workspaceRoot)}`,
    `${chalk.bold("Host:")}       ${chalk.gray(cfg.host ?? "default local Ollama")}`,
    `${chalk.bold("Tools:")}      ${chalk.yellow(
      [...agent.getRegistry().schemas()].map((s) => s.function.name).join(", ")
    )}`,
    "",
    chalk.dim("Press [Tab] for commands, type /help, or use Ctrl-C to quit.")
  ].join("\n");

  console.log(
    boxen(bannerText, {
      padding: 1,
      margin: { top: 1, bottom: 1, left: 0, right: 0 },
      borderColor: "magenta",
      borderStyle: "double",
      title: "DevAgent",
      titleAlignment: "center",
    })
  );

  // Tab completion implementation
  const completer = (line: string) => {
    const completions = ["/help", "/models", "/model ", "/clear", "/reset", "/exit", "/quit"];
    
    if (line.startsWith("/model ")) {
      const partialModel = line.slice("/model ".length);
      const modelHits = modelsList.filter((m) => m.startsWith(partialModel));
      return [modelHits.map((m) => `/model ${m}`), line];
    }

    const hits = completions.filter((c) => c.startsWith(line));
    return [hits.length ? hits : completions, line];
  };

  const historyPath = path.join(cfg.workspaceRoot, ".devagent_history");
  let initialHistory: string[] = [];
  try {
    if (fs.existsSync(historyPath)) {
      const content = fs.readFileSync(historyPath, "utf-8");
      initialHistory = content
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    }
  } catch {
    // Ignore history load errors
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer,
  });

  // Assign history and ensure uniqueness
  const seenHistory = new Set<string>();
  (rl as any).history = initialHistory.filter((item) => {
    if (seenHistory.has(item)) return false;
    seenHistory.add(item);
    return true;
  });

  const saveHistory = () => {
    try {
      const seen = new Set<string>();
      const uniqueHistory = ((rl as any).history as string[]).filter((item) => {
        const trimmed = item.trim();
        if (!trimmed || trimmed.startsWith("/") || seen.has(trimmed)) {
          return false;
        }
        seen.add(trimmed);
        return true;
      });
      fs.writeFileSync(historyPath, uniqueHistory.join("\n"), "utf-8");
    } catch {
      // Ignore history save errors
    }
  };

  const updatePrompt = () => {
    rl.setPrompt(
      chalk.magenta.bold("devagent-ts") +
        " " +
        chalk.cyan(`(${agent.currentModel})`) +
        chalk.green.bold(" ❯ ")
    );
  };

  updatePrompt();
  rl.prompt();

  const spinner = ora({
    color: "cyan",
    spinner: "dots",
  });

  rl.on("line", async (raw) => {
    // Clean and deduplicate history, removing commands
    const seen = new Set<string>();
    (rl as any).history = ((rl as any).history as string[]).filter((item) => {
      const trimmed = item.trim();
      if (!trimmed || trimmed.startsWith("/") || seen.has(trimmed)) {
        return false;
      }
      seen.add(trimmed);
      return true;
    });
    saveHistory();

    const text = raw.trim();
    if (!text) {
      rl.prompt();
      return;
    }

    // Command handling
    if (text.startsWith("/")) {
      if (text === "/help") {
        const helpText = [
          chalk.bold.blue("💡 Available Commands:"),
          "",
          `${chalk.cyan("/model <name>")}  Switch Ollama model for this session`,
          `${chalk.cyan("/models")}        List available models in Ollama`,
          `${chalk.cyan("/clear")}         Clear the terminal screen`,
          `${chalk.cyan("/reset")}         Reset conversation history`,
          `${chalk.cyan("/exit")}          Exit DevAgent`,
          `${chalk.cyan("/quit")}          Exit DevAgent`,
        ].join("\n");
        console.log(
          boxen(helpText, {
            padding: 1,
            margin: { top: 0, bottom: 1, left: 0, right: 0 },
            borderColor: "blue",
            borderStyle: "round",
          })
        );
        rl.prompt();
        return;
      }

      if (text === "/exit" || text === "/quit") {
        rl.close();
        return;
      }

      if (text === "/clear") {
        console.clear();
        rl.prompt();
        return;
      }

      if (text === "/reset") {
        agent.resetContext();
        console.log(chalk.green("✔ Conversation history has been reset."));
        rl.prompt();
        return;
      }

      if (text === "/models") {
        spinner.start("Fetching available models...");
        const models = await listModels(cfg.host);
        spinner.stop();
        if (models.length === 0) {
          console.log(chalk.red("✖ No models found or Ollama is unreachable."));
        } else {
          console.log(chalk.bold("\nAvailable Ollama Models:"));
          models.forEach((m) => console.log(` - ${chalk.cyan(m)}`));
          console.log();
        }
        rl.prompt();
        return;
      }

      if (text.startsWith("/model ")) {
        const modelName = text.slice("/model ".length).trim();
        if (!modelName) {
          console.log(chalk.red("✖ Usage: /model <model_name>"));
          rl.prompt();
          return;
        }
        agent.setModel(modelName);
        console.log(chalk.green(`✔ Switched model to: ${chalk.bold(agent.currentModel)}`));
        updatePrompt();
        rl.prompt();
        return;
      }

      console.log(chalk.red(`✖ Unknown command: ${text}. Type /help for available commands.`));
      rl.prompt();
      return;
    }

    // Pause readline input to avoid overlapping prompts/keypresses during agent run
    rl.pause();

    let isStreaming = false;
    let isThinking = false;
    let lastToolName = "";
    let lastToolArgs: Record<string, any> = {};

    // Register temporary event handlers for this specific run
    const events = (agent as any).events;

    events.onStatus = (status: string) => {
      if (isThinking) {
        process.stdout.write("\n");
        isThinking = false;
      }
      if (isStreaming) {
        process.stdout.write("\n");
        isStreaming = false;
      }

      spinner.text = chalk.cyan(`Agent status: ${status}...`);
      if (!spinner.isSpinning) {
        spinner.start();
      }
    };

    events.onThinking = (thinkingChunk: string) => {
      if (spinner.isSpinning) {
        spinner.stop();
      }
      if (isStreaming) {
        process.stdout.write("\n");
        isStreaming = false;
      }
      if (!isThinking) {
        isThinking = true;
        process.stdout.write(chalk.gray.italic("🧠 Thinking: "));
      }
      process.stdout.write(chalk.gray.italic(thinkingChunk));
    };

    events.onAssistantText = (chunk: string) => {
      if (spinner.isSpinning) {
        spinner.stop();
      }
      if (isThinking) {
        process.stdout.write("\n");
        isThinking = false;
      }
      if (!isStreaming) {
        isStreaming = true;
        process.stdout.write(chalk.magenta.bold("🤖 DevAgent: "));
      }
      process.stdout.write(chunk);
    };

    events.onToolCall = (name: string, args: Record<string, unknown>) => {
      lastToolName = name;
      lastToolArgs = args;

      if (isThinking) {
        process.stdout.write("\n");
        isThinking = false;
      }
      if (isStreaming) {
        process.stdout.write("\n");
        isStreaming = false;
      }
      if (spinner.isSpinning) {
        spinner.stop();
      }

      // Single-line elegant spinner for the active tool run
      let desc = "";
      if (name === "read_file") desc = args.path as string;
      else if (name === "write_file") desc = args.path as string;
      else if (name === "run_shell") desc = `"${args.command}"`;

      spinner.start(chalk.yellow(`⚙  Executing [${name}] ${desc}...`));
    };

    events.onToolResult = (name: string, result: Record<string, unknown> | string) => {
      if (spinner.isSpinning) {
        spinner.stop();
      }

      let desc = "";
      if (name === "read_file") desc = lastToolArgs.path as string;
      else if (name === "write_file") desc = lastToolArgs.path as string;
      else if (name === "run_shell") desc = `"${lastToolArgs.command}"`;

      let outcome = "";
      let isError = false;

      if (name === "read_file") {
        if (typeof result === "string") {
          outcome = `${result.split("\n").length} lines read`;
        } else if (result && result.error) {
          outcome = String(result.error);
          isError = true;
        }
      } else if (name === "write_file") {
        const resObj = result as any;
        if (resObj && resObj.error) {
          outcome = String(resObj.error);
          isError = true;
        } else {
          outcome = `written successfully`;
        }
      } else if (name === "run_shell") {
        if (result && typeof result === "object") {
          const code = result.exitCode as number;
          isError = code !== 0;
          outcome = `exit code ${code}`;
          if (isError && result.stderr) {
            outcome += ` - ${String(result.stderr).substring(0, 100).trim()}`;
          }
        } else {
          outcome = String(result);
        }
      } else {
        outcome = typeof result === "string" ? result : JSON.stringify(result);
      }

      // Elegantly log completion using spinner status (do not duplicate checkmarks/crosses)
      if (isError) {
        spinner.fail(chalk.red(`[${name}] ${desc} (${outcome})`));
      } else {
        spinner.succeed(chalk.green(`[${name}] ${desc} (${outcome})`));
      }
    };

    events.onError = (error: Error) => {
      if (spinner.isSpinning) {
        spinner.stop();
      }
      console.log(chalk.red.bold(`✖  Agent Error: ${error.message}`));
    };

    spinner.start("Initializing task execution...");
    try {
      await agent.runUserMessage(text);
      
      if (spinner.isSpinning) {
        spinner.stop();
      }
      if (isThinking) {
        process.stdout.write("\n");
        isThinking = false;
      }
      if (isStreaming) {
        process.stdout.write("\n");
        isStreaming = false;
      }
      console.log(); // Print a trailing newline for spacing
    } catch (e) {
      if (spinner.isSpinning) {
        spinner.stop();
      }
      console.error(chalk.red(`\n✖ Execution aborted: ${(e as Error).message}\n`));
    } finally {
      // Resume user input
      rl.resume();
      updatePrompt();
      rl.prompt();
    }
  });

  rl.on("close", () => {
    console.log(chalk.cyan("\nGoodbye! 👋\n"));
    process.exit(0);
  });

  rl.on("SIGINT", () => {
    rl.close();
  });
}
