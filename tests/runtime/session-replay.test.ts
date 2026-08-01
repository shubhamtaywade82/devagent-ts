import { ExecutionNodeGraph } from "../../src/runtime/event-node.js";
import { SessionReplayManager } from "../../src/runtime/session-replay.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Runtime - Event Node Graph & Replay", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "devagent-replay-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("builds execution node tree with parent-child relationships", () => {
    const graph = new ExecutionNodeGraph();
    const parent = graph.startNode("parent-1", "planner", "Break down request");
    const child = graph.startNode("child-1", "tool", "ReadFile src/main.ts", "parent-1");

    expect(graph.getAllNodes().length).toBe(2);
    expect(graph.getRootNodes().length).toBe(1);
    expect(parent.children?.length).toBe(1);
    expect(parent.children?.[0]?.id).toBe("child-1");

    graph.updateNode("child-1", "completed");
    expect(child.status).toBe("completed");
    expect(child.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("saves and loads session trajectory files", () => {
    const manager = new SessionReplayManager(tempDir);
    const graph = new ExecutionNodeGraph();
    graph.startNode("n1", "intent", "Detect User Intent");
    graph.updateNode("n1", "completed");

    const savedPath = manager.saveSession("session-123", graph.getAllNodes(), "Test Goal");
    expect(savedPath).toContain("session-123.events.json");

    const loaded = manager.loadSession("session-123");
    expect(loaded).not.toBeNull();
    expect(loaded?.sessionId).toBe("session-123");
    expect(loaded?.goal).toBe("Test Goal");
    expect(loaded?.nodes.length).toBe(1);
  });
});
