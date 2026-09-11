export type ExecutionNodeKind =
  | "intent"
  | "planner"
  | "context"
  | "intelligence"
  | "memory"
  | "router"
  | "orchestrator"
  | "tool"
  | "mcp"
  | "verification"
  | "reflection"
  | "git";

export type ExecutionNodeStatus =
  "pending" | "running" | "waiting" | "completed" | "failed" | "collapsed" | "paused" | "cancelled" | "retrying";

export interface ExecutionNodeDetails {
  prompt?: string;
  model?: string;
  rationale?: string;
  durationMs?: number;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  diffPath?: string;
  diagnostics?: Array<{ severity: string; message: string }>;
  [key: string]: unknown;
}

export interface ExecutionNode {
  id: string;
  kind: ExecutionNodeKind;
  title: string;
  status: ExecutionNodeStatus;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  parentId?: string;
  details?: ExecutionNodeDetails;
  children?: ExecutionNode[];
}

export class ExecutionNodeGraph {
  private nodes = new Map<string, ExecutionNode>();
  private activeId?: string;

  startNode(
    id: string,
    kind: ExecutionNodeKind,
    title: string,
    parentId?: string,
    details?: ExecutionNodeDetails,
  ): ExecutionNode {
    const node: ExecutionNode = {
      id,
      kind,
      title,
      status: "running",
      startTime: Date.now(),
      parentId,
      details,
      children: [],
    };
    this.nodes.set(id, node);
    if (parentId && this.nodes.has(parentId)) {
      const parent = this.nodes.get(parentId)!;
      parent.children = parent.children || [];
      parent.children.push(node);
    }
    this.activeId = id;
    return node;
  }

  updateNode(id: string, status: ExecutionNodeStatus, details?: ExecutionNodeDetails): ExecutionNode | undefined {
    const node = this.nodes.get(id);
    if (!node) return undefined;
    node.status = status;
    if (details) {
      node.details = { ...(node.details || {}), ...details };
    }
    if (status === "completed" || status === "failed") {
      node.endTime = Date.now();
      node.durationMs = node.endTime - node.startTime;
      if (this.activeId === id) {
        this.activeId = node.parentId;
      }
    }
    return node;
  }

  getNode(id: string): ExecutionNode | undefined {
    return this.nodes.get(id);
  }

  getActiveNode(): ExecutionNode | undefined {
    return this.activeId ? this.nodes.get(this.activeId) : undefined;
  }

  getAllNodes(): ExecutionNode[] {
    return Array.from(this.nodes.values());
  }

  getRootNodes(): ExecutionNode[] {
    return Array.from(this.nodes.values()).filter((n) => !n.parentId);
  }
}
