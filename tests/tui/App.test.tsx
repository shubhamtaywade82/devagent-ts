import React from "react";
import { render } from "ink-testing-library";
import { App, ShellAgent } from "../../src/tui/App";
import { EventBus } from "../../src/runtime/events";
import { initialRuntimeState, Store } from "../../src/runtime/store";

const NOW = new Date(2026, 0, 1, 10, 42, 11).getTime();

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function makeWorld() {
  const bus = new EventBus();
  const store = new Store(initialRuntimeState({ workspace: "ollama-agent", branch: "main", model: "qwen3:30b" }));
  store.attach(bus);
  const agent: ShellAgent & { calls: string[]; models: string[] } = {
    calls: [],
    models: [],
    runUserMessage: jest.fn(async (m: string) => {
      agent.calls.push(m);
      return "ok";
    }),
    setModel: (m: string) => {
      agent.models.push(m);
    },
    listModels: jest.fn(async () => ["qwen3:30b", "qwen3:8b", "deepseek"]),
  };
  return { bus, store, agent };
}

function renderApp(columns = 100, rows = 30, seed?: (world: ReturnType<typeof makeWorld>) => void) {
  const world = makeWorld();
  seed?.(world);
  const r = render(
    <App bus={world.bus} store={world.store} agent={world.agent} columns={columns} rows={rows} now={NOW} />,
  );
  return { ...world, ...r };
}

// Above App's FAST_INPUT_MS (20ms) burst-paste-detection threshold — a real
// human never sends two keystrokes within 20ms, but a same-tick 0ms test
// helper would, and App would (correctly) mistake that for a paste burst.
const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

describe("App shell", () => {
  it("renders all five permanent zones", () => {
    const { lastFrame, unmount } = renderApp();
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("DevAgent"); // header
    expect(frame).toContain("1 Conversation"); // active view title
    expect(frame).toContain("Chat"); // activity strip
    expect(frame).toContain("❯"); // prompt
    expect(frame).toContain("Mode:NORMAL"); // context strip
    unmount();
  });

  it("keys 1-8 focus views; Tab cycles", async () => {
    const { stdin, lastFrame, unmount } = renderApp();
    await tick();
    stdin.write("4");
    await tick();
    expect(stripAnsi(lastFrame() ?? "")).toContain("4 Git");
    stdin.write("\t");
    await tick();
    expect(stripAnsi(lastFrame() ?? "")).toContain("5 Logs");
    unmount();
  });

  it("Ctrl+P opens the palette and Esc closes it", async () => {
    const { stdin, lastFrame, unmount } = renderApp();
    await tick();
    stdin.write("");
    await tick();
    expect(stripAnsi(lastFrame() ?? "")).toContain("Command Palette");
    stdin.write("");
    await tick();
    expect(stripAnsi(lastFrame() ?? "")).not.toContain("Command Palette");
    unmount();
  });

  it("? opens help; Ctrl+B opens actors overlay", async () => {
    const { stdin, lastFrame, unmount } = renderApp();
    await tick();
    stdin.write("?");
    await tick();
    expect(stripAnsi(lastFrame() ?? "")).toContain("Help — Keys");
    stdin.write("");
    await tick();
    stdin.write("");
    await tick();
    expect(stripAnsi(lastFrame() ?? "")).toContain("Actors — all alive");
    unmount();
  });

  it("typed text lands in the prompt and Enter submits to the agent", async () => {
    const { stdin, lastFrame, agent, store, unmount } = renderApp();
    await tick();
    stdin.write("fix the bug");
    await tick();
    expect(stripAnsi(lastFrame() ?? "")).toContain("fix the bug");
    stdin.write("\r");
    await tick();
    expect(agent.calls).toEqual(["fix the bug"]);
    expect(store.getState().conversation[0]).toMatchObject({ role: "user", text: "fix the bug" });
    unmount();
  });

  it("digits type into a non-empty prompt instead of switching views", async () => {
    const { stdin, lastFrame, unmount } = renderApp();
    await tick();
    stdin.write("add ");
    stdin.write("2");
    await tick();
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("1 Conversation");
    expect(frame).toContain("add 2");
    unmount();
  });

  it("slash commands execute: /model sets the model", async () => {
    const { stdin, agent, store, unmount } = renderApp();
    await tick();
    stdin.write("/model qwen3:8b");
    await tick();
    stdin.write("\r");
    await tick();
    expect(agent.models).toEqual(["qwen3:8b"]);
    expect(store.getState().model.name).toBe("qwen3:8b");
    expect(agent.calls).toEqual([]); // never sent to the model as chat
    unmount();
  });

  it("slash typing shows completion hints in the context strip", async () => {
    const { stdin, lastFrame, unmount } = renderApp();
    await tick();
    stdin.write("/mo");
    await tick();
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("/model");
    expect(frame).toContain("/models");
    unmount();
  });

  it("approval flow: overlay appears and 'a' approves", async () => {
    const { stdin, lastFrame, store, unmount } = renderApp(100, 30, ({ bus }) => {
      bus.publish({
        type: "approval.requested",
        request: {
          id: "ap1",
          title: "Apply patch",
          summary: "Edit fs.ts",
          filesChanged: 3,
          additions: 128,
          deletions: 4,
        },
      });
    });
    await tick();
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("Approval Required");
    expect(frame).toContain("Waiting for approval");
    stdin.write("a");
    await tick();
    expect(store.getState().approval).toBeNull();
    expect(store.getState().mode).toBe("idle");
    unmount();
  });

  it("/model with no args opens the switcher; selecting sets the model", async () => {
    const { stdin, lastFrame, agent, store, unmount } = renderApp();
    await tick();
    stdin.write("/model");
    await tick();
    stdin.write("\r");
    await tick();
    await tick(); // listModels resolves
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("Switch Model");
    expect(frame).toContain("deepseek");
    stdin.write("\u001B[B"); // down to qwen3:8b
    await tick();
    stdin.write("\r");
    await tick();
    expect(agent.models).toEqual(["qwen3:8b"]);
    expect(store.getState().model.name).toBe("qwen3:8b");
    expect(stripAnsi(lastFrame() ?? "")).not.toContain("Switch Model");
    unmount();
  });

  it("reverts and reports an error when the new model fails validation", async () => {
    const bus = new EventBus();
    const store = new Store(initialRuntimeState({ workspace: "ollama-agent", branch: "main", model: "qwen3:30b" }));
    store.attach(bus);
    const agent: ShellAgent & { calls: string[]; models: string[] } = {
      calls: [],
      models: [],
      runUserMessage: jest.fn(async () => "ok"),
      setModel: (m: string) => {
        agent.models.push(m);
      },
      listModels: jest.fn(async () => ["qwen3:30b", "nomic-embed-text:latest"]),
      validateModel: jest.fn(async () => "unreachable: 404 model not found"),
    };
    const { stdin, lastFrame, unmount } = render(
      <App bus={bus} store={store} agent={agent} columns={100} rows={30} now={NOW} />,
    );
    await tick();
    stdin.write("/model");
    await tick();
    stdin.write("\r");
    await tick();
    await tick(); // listModels resolves
    stdin.write("[B"); // down to nomic-embed-text:latest
    await tick();
    stdin.write("\r");
    await tick(); // validateModel resolves and reverts
    await tick();
    expect(agent.models).toEqual(["nomic-embed-text:latest", "qwen3:30b"]); // set, then reverted
    expect(store.getState().model.name).toBe("qwen3:30b");
    expect(stripAnsi(lastFrame() ?? "")).toContain("nomic-embed-text:latest unreachable: 404 model not found");
    unmount();
  });

  it("Ctrl+F opens search everywhere; selecting a log result focuses Logs", async () => {
    const { stdin, lastFrame, unmount } = renderApp(100, 30, ({ bus }) => {
      bus.publish({ type: "logs.appended", level: "error", source: "shell", message: "exit code 1" });
    });
    await tick();
    stdin.write("\u0006");
    await tick();
    expect(stripAnsi(lastFrame() ?? "")).toContain("Search Everywhere");
    stdin.write("exit code");
    await tick();
    stdin.write("\r");
    await tick();
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).not.toContain("Search Everywhere");
    expect(frame).toContain("5 Logs");
    unmount();
  });

  it("@ templates complete and Tab inserts the template body", async () => {
    const { stdin, lastFrame, unmount } = renderApp();
    await tick();
    stdin.write("@re");
    await tick();
    let frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("@review");
    expect(frame).toContain("@refactor");
    stdin.write("\t");
    await tick();
    frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("Review the following");
    unmount();
  });

  it("collapses a multi-line paste into a placeholder even without bracketed-paste markers", async () => {
    const { stdin, lastFrame, unmount } = renderApp();
    await tick();
    // Terminals that don't support/emit \x1b[200~..\x1b[201~ still deliver a
    // paste as one chunk with embedded newlines through Ink's normal stdin —
    // this must collapse the same way bracketed paste does.
    stdin.write("line one\nline two\nline three");
    await tick();
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("⏎ 3 lines");
    expect(frame).toContain("[Pasted text #1 +3 lines]");
    unmount();
  });

  it("does not submit each line as its own message when a terminal splits a paste into per-line Enter events", async () => {
    const { stdin, lastFrame, agent, unmount } = renderApp();
    await tick();
    // Some terminals deliver a multi-line paste as one "data" event PER
    // LINE, each ending in a lone \r that Ink reads as a real Enter keypress
    // — without burst detection every line would get submitted individually.
    const lines = ["# DevAgent TS", "", "second line", "third line"];
    for (const line of lines) {
      stdin.write(line);
      stdin.write("\r");
    }
    await new Promise((resolve) => setTimeout(resolve, 100)); // let the burst-idle debounce fire
    expect(agent.calls).toEqual([]); // nothing submitted prematurely
    const frame = stripAnsi(lastFrame() ?? "");
    // each line's trailing \r appends its own newline, including the last
    // one, so 4 pasted lines produce a 5th trailing empty segment
    expect(frame).toContain("[Pasted text #1 +5 lines]");
    stdin.write("\r"); // now submit for real
    await tick();
    expect(agent.calls).toEqual(["[Pasted text #1 +5 lines]\n# DevAgent TS\n\nsecond line\nthird line"]);
    unmount();
  });

  it("streaming state reaches conversation and strips", () => {
    const { lastFrame, unmount } = renderApp(120, 30, ({ bus }) => {
      bus.publish({ type: "conversation.message", role: "user", text: "implement login" });
      bus.publish({ type: "conversation.chunk", role: "assistant", chunk: "Working on it" });
      bus.publish({ type: "mode.changed", mode: "streaming" });
      bus.publish({ type: "model.streaming", streaming: true, tokensPerSecond: 81 });
    });
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("implement login");
    expect(frame).toContain("Working on it");
    expect(frame).toContain("Generating...");
    expect(frame).toContain("81 tok/s");
    unmount();
  });
});

describe("resize safety (regression)", () => {
  const sizes: [number, number][] = [
    [80, 24],
    [100, 30],
    [120, 30],
    [160, 45],
    [220, 60],
  ];

  it.each(sizes)("no overflow and no lost zones at %dx%d", (columns, rows) => {
    const { lastFrame, unmount } = renderApp(columns, rows, ({ bus }) => {
      bus.publish({ type: "conversation.message", role: "user", text: "create filesystem tool ".repeat(10) });
      bus.publish({ type: "conversation.chunk", role: "assistant", chunk: "Reading package.json\n".repeat(30) });
      for (let i = 0; i < 40; i++) {
        bus.publish({ type: "logs.appended", level: "info", source: "tool", message: `log line ${i}` });
      }
      bus.publish({ type: "context.changed", used: 48000, limit: 71000 });
    });
    const frame = stripAnsi(lastFrame() ?? "");
    const lines = frame.split("\n");
    expect(lines.length).toBeLessThanOrEqual(rows);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(columns);
    }
    // Every zone still present.
    expect(frame).toContain("DevAgent");
    expect(frame).toContain("Conversation");
    expect(frame).toContain("Chat");
    expect(frame).toContain("❯");
    unmount();
  });
});
