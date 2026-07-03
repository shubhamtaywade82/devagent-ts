import * as readline from "node:readline";
import chalk from "chalk";
import ora from "ora";
import boxen from "boxen";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";

import { Agent } from "./agent";
import { CliConfig, loadConfig } from "./config";

// Setup marked terminal styling
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
  }) as any
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

  // Render a premium startup banner using boxen and chalk
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
    chalk.dim("Type a task below to start. For help, type /help. Ctrl-C to quit.")
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

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

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

    // Message execution
    let isStreaming = false;
    let accumulatedText = "";

    // Register temporary event handlers for this specific run
    const events = (agent as any).events;
    events.onStatus = (status: string) => {
      if (isStreaming) {
        process.stdout.write("\n");
        isStreaming = false;
      }
      spinner.text = chalk.cyan(`Agent status: ${status}...`);
      if (!spinner.isSpinning) {
        spinner.start();
      }
    };

    events.onAssistantText = (chunk: string) => {
      if (spinner.isSpinning) {
        spinner.stop();
      }
      if (!isStreaming) {
        isStreaming = true;
        process.stdout.write(chalk.magenta.bold("🤖 DevAgent: "));
      }
      process.stdout.write(chunk);
      accumulatedText += chunk;
    };

    events.onToolCall = (name: string, args: Record<string, unknown>) => {
      if (isStreaming) {
        process.stdout.write("\n");
        isStreaming = false;
      }
      if (spinner.isSpinning) {
        spinner.stop();
      }

      const argsStr = JSON.stringify(args, null, 2);
      const toolCallText = [
        chalk.yellow.bold(`⚙  Tool Call: ${name}`),
        chalk.gray(argsStr.length > 300 ? argsStr.substring(0, 300) + "\n... (args truncated)" : argsStr),
      ].join("\n");

      console.log(
        boxen(toolCallText, {
          padding: 0,
          margin: { top: 0, bottom: 0, left: 0, right: 0 },
          borderColor: "yellow",
          borderStyle: "round",
          dimBorder: true,
        })
      );

      spinner.start(`Executing tool ${name}...`);
    };

    events.onToolResult = (name: string, result: Record<string, unknown> | string) => {
      if (spinner.isSpinning) {
        spinner.stop();
      }

      let preview = "";
      let isError = false;

      if (typeof result === "string") {
        preview = result.length > 300 ? result.substring(0, 300) + "\n... (truncated)" : result;
        isError = result.includes("PathEscapeError") || result.includes("Error");
      } else if (result && typeof result === "object") {
        if ("exitCode" in result) {
          const code = result.exitCode as number;
          preview = `Exit Code: ${code}\n`;
          if (result.stdout) {
            preview += `Stdout:\n${chalk.gray((result.stdout as string).substring(0, 300))}\n`;
          }
          if (result.stderr) {
            preview += `Stderr:\n${chalk.red((result.stderr as string).substring(0, 300))}\n`;
          }
          isError = code !== 0;
        } else {
          const str = JSON.stringify(result, null, 2);
          preview = str.length > 300 ? str.substring(0, 300) + "\n... (truncated)" : str;
        }
      }

      const resultText = [
        isError ? chalk.red.bold(`✖  Tool Result: ${name}`) : chalk.green.bold(`✔  Tool Result: ${name}`),
        preview.trim(),
      ].join("\n");

      console.log(
        boxen(resultText, {
          padding: 0,
          margin: { top: 0, bottom: 0, left: 0, right: 0 },
          borderColor: isError ? "red" : "green",
          borderStyle: "round",
          dimBorder: true,
        })
      );
    };

    events.onError = (error: Error) => {
      if (spinner.isSpinning) {
        spinner.stop();
      }
      console.log(
        boxen(chalk.red.bold(`✖  Agent Error: ${error.message}`), {
          padding: 0,
          margin: { top: 0, bottom: 0, left: 0, right: 0 },
          borderColor: "red",
          borderStyle: "round",
        })
      );
    };

    spinner.start("Initializing task execution...");
    try {
      const answer = await agent.runUserMessage(text);
      if (spinner.isSpinning) {
        spinner.stop();
      }
      if (isStreaming) {
        process.stdout.write("\n");
        isStreaming = false;
      }

      // Final markdown format of the answer for a clean readable render
      if (answer && answer !== "(tool budget exceeded)") {
        console.log(chalk.bold("\n📝 Polished Response:"));
        console.log(marked.parse(answer));
      } else {
        console.log(chalk.red("\n✖ Tool execution budget exceeded or empty response."));
      }
    } catch (e) {
      if (spinner.isSpinning) {
        spinner.stop();
      }
      console.error(chalk.red(`\n✖ Execution aborted: ${(e as Error).message}`));
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log(chalk.cyan("\nGoodbye! 👋\n"));
    process.exit(0);
  });

  rl.on("SIGINT", () => {
    rl.close();
  });
}
