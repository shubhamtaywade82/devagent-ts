import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecutionNode } from "./event-node.js";
import { workspaceStateDir } from "../platform/paths.js";

export interface SessionTrajectory {
  sessionId: string;
  timestamp: number;
  goal?: string;
  nodes: ExecutionNode[];
}

export class SessionReplayManager {
  private sessionsDir: string;

  constructor(workspaceRoot: string) {
    this.sessionsDir = join(workspaceStateDir(workspaceRoot), "sessions");
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  saveSession(sessionId: string, nodes: ExecutionNode[], goal?: string): string {
    const trajectory: SessionTrajectory = {
      sessionId,
      timestamp: Date.now(),
      goal,
      nodes,
    };
    const filePath = join(this.sessionsDir, `${sessionId}.events.json`);
    writeFileSync(filePath, JSON.stringify(trajectory, null, 2), "utf8");
    return filePath;
  }

  loadSession(sessionId: string): SessionTrajectory | null {
    const filePath = join(this.sessionsDir, `${sessionId}.events.json`);
    if (!existsSync(filePath)) return null;
    try {
      const raw = readFileSync(filePath, "utf8");
      return JSON.parse(raw) as SessionTrajectory;
    } catch {
      return null;
    }
  }

  listSessions(): string[] {
    if (!existsSync(this.sessionsDir)) return [];
    try {
      const files: string[] = readdirSync(this.sessionsDir);
      return files.filter((f: string) => f.endsWith(".events.json")).map((f: string) => f.replace(".events.json", ""));
    } catch {
      return [];
    }
  }

  getPlaybackIntervalMs(durationMs: number, speedMultiplier: 1 | 2 | 5 = 1): number {
    return Math.max(50, Math.floor(durationMs / speedMultiplier));
  }
}
