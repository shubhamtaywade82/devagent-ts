/**
 * AgentMutationStrategy — REAL autonomous code mutation.
 *
 * The default HeuristicMutationStrategy only writes a self-describing
 * nexum.harness.json policy file; it changes the repository but not the
 * harness runtime's behavior. This strategy closes that gap: it invokes an
 * injectable EngineeringAgentRuntime — Nexum's own engineering agent, an LLM,
 * or any patch-producing process — INSIDE the candidate worktree, so the
 * mutation touches the actual implementation (src/tools/..., src/runtime/...)
 * that the benchmark suite then evaluates.
 *
 *   target → agent inspects the worktree (+ experience/telemetry digests)
 *          → agent proposes concrete file edits
 *          → strategy maps them into a scope-attributed CodeChangePlan
 *          → executor implement/verify/finalize (unchanged safety pipeline)
 *
 * Trust boundary (defense in depth):
 *   1. the agent RECEIVES the allowed-path list and is asked to respect it;
 *   2. the strategy attributes every proposed edit to a scope component;
 *   3. the executor's scope guard rejects out-of-scope PLANNED edits at
 *      implement time;
 *   4. the executor's verify() audits the ACTUAL git diff (including any
 *      side effects the strategy or agent smuggled onto disk) against the
 *      allowed scope — actual changed files ⊆ allowed mutation paths.
 * The strategy therefore never needs to be trusted; it needs to be audited.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { HarnessComponent, HarnessDiagnosis } from "../types.js";
import { ImprovementTarget } from "../targets/target-engine.js";
import { MutationScope } from "./mutation-scope.js";
import {
  CodeChangePlan,
  DEFAULT_COMPONENT_PATHS,
  InspectTargetContext,
  MutationStrategy,
} from "./mutation-executor.js";

// ── Agent runtime contract ──────────────────────────────────────────────────

/**
 * Read-only view of the candidate worktree handed to the engineering agent.
 * Every path is repo-relative and confined to the worktree.
 */
export interface AgentWorkspaceView {
  worktreePath: string;
  /** Absolute path of the host repository (for git-level context only). */
  repoRoot: string;
  /** Commit the candidate branches from. */
  parentCommit: string;
  /** Reads a repo-relative file from the worktree (null when missing). */
  readFile(path: string): Promise<string | null>;
  /** Lists repo-relative files under a prefix (recursive, .git excluded). */
  listFiles(prefix?: string): Promise<string[]>;
}

/**
 * The pluggable boundary between the evolution system and an ACTUAL
 * engineering agent. Implement this with Nexum's own runtime, an LLM API, a
 * sandboxed coding agent, or any deterministic patch generator.
 */
export interface EngineeringAgentRuntime {
  readonly name: string;
  /**
   * Investigates the worktree and proposes concrete file edits. Implementations
   * MUST NOT write to disk — they only propose; the executor applies, verifies,
   * and commits. Returning `declined` aborts the cycle without a candidate.
   */
  proposeMutation(request: AgentMutationRequest): Promise<AgentMutationResponse> | AgentMutationResponse;
}

export interface AgentMutationRequest {
  worktree: AgentWorkspaceView;
  target: ImprovementTarget;
  diagnosis?: HarnessDiagnosis;
  scope: MutationScope;
  /** Repo-relative path prefixes the agent is allowed to modify. */
  allowedPaths: string[];
  /** Evidence-grounded experience digest for the target capability (optional). */
  experienceDigest?: string;
  /** Operational telemetry digest for the active harness (optional). */
  telemetryDigest?: string;
}

export interface AgentEditProposal {
  /** Repo-relative file path (POSIX separators). */
  path: string;
  /** FULL new content of the file (agents propose whole files, not diffs). */
  content: string;
  rationale: string;
}

export interface AgentMutationResponse {
  edits: AgentEditProposal[];
  /** How the agent investigated (files read, patterns, telemetry consulted). */
  investigation: string[];
  summary: string;
  /** When set, the agent concluded no safe mutation exists; no plan is produced. */
  declined?: { reason: string };
}

/** Thrown when the agent declines to mutate (no candidate should be created). */
export class AgentDeclinedError extends Error {
  constructor(public readonly reason: string) {
    super(`Mutation agent declined: ${reason}`);
    this.name = "AgentDeclinedError";
  }
}

/** Thrown when the agent's response violates the strategy's safety envelope. */
export class AgentMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentMutationError";
  }
}

// ── Strategy ────────────────────────────────────────────────────────────────

export interface AgentMutationStrategyOptions {
  runtime: EngineeringAgentRuntime;
  /** Component → allowed repo-relative path prefixes (defaults to v2 map). */
  componentPaths?: Partial<Record<HarnessComponent, string[]>>;
  /** Extra always-allowed path prefixes (defaults to the harness manifest). */
  extraAllowedPaths?: string[];
  /** Upper bound on proposed edits; a larger response aborts the cycle. */
  maxEdits?: number;
}

export class AgentMutationStrategy implements MutationStrategy {
  readonly name: string;
  private readonly runtime: EngineeringAgentRuntime;
  private readonly componentPaths: Partial<Record<HarnessComponent, string[]>>;
  private readonly extraAllowedPaths: string[];
  private readonly maxEdits: number;

  constructor(opts: AgentMutationStrategyOptions) {
    this.runtime = opts.runtime;
    this.name = `agent:${opts.runtime.name}`;
    this.componentPaths = opts.componentPaths ?? {};
    this.extraAllowedPaths = opts.extraAllowedPaths ?? ["nexum.harness.json"];
    this.maxEdits = opts.maxEdits ?? 25;
  }

  /**
   * The allowed-path list handed to the agent AND used to attribute each
   * proposed edit to a scope component: union of the scope components'
   * prefix maps plus the always-allowed extras.
   */
  allowedPathsFor(scope: MutationScope): string[] {
    const prefixes = new Set<string>(this.extraAllowedPaths);
    for (const component of scope.components) {
      for (const p of this.componentPaths[component] ?? DEFAULT_COMPONENT_PATHS[component] ?? ["src/"]) {
        prefixes.add(p);
      }
    }
    return [...prefixes].sort();
  }

  async inspectTarget(input: {
    worktreePath: string;
    target: ImprovementTarget;
    context: InspectTargetContext;
  }): Promise<CodeChangePlan> {
    const { target, context } = input;

    const response = await this.runtime.proposeMutation({
      worktree: this.workspaceView(input.worktreePath, context),
      target,
      diagnosis: context.diagnosis,
      scope: context.scope,
      allowedPaths: this.allowedPathsFor(context.scope),
      experienceDigest: context.experienceDigest,
      telemetryDigest: context.telemetryDigest,
    });

    if (response.declined) throw new AgentDeclinedError(response.declined.reason);
    if (!Array.isArray(response.edits)) {
      throw new AgentMutationError(`Runtime ${this.runtime.name} returned no edits array`);
    }
    if (response.edits.length > this.maxEdits) {
      throw new AgentMutationError(
        `Runtime ${this.runtime.name} proposed ${response.edits.length} edits; the safety envelope caps a single mutation at ${this.maxEdits}.`,
      );
    }

    // Attribute each proposal to the first scope component whose prefix map
    // covers the path; unmatched paths fall back to the primary component so
    // the executor's scope guard (not the strategy) delivers the verdict.
    const edits = response.edits.map((edit) => ({
      path: edit.path,
      content: edit.content,
      component: this.attributeComponent(edit.path, context.scope),
      rationale: edit.rationale,
    }));

    return {
      planId: `plan-${target.id}-${Date.now()}`,
      targetId: target.id,
      summary:
        response.investigation.length > 0
          ? `${response.summary} (investigated: ${response.investigation.slice(0, 5).join(", ")})`
          : response.summary,
      strategy: this.name,
      edits,
      createdAt: Date.now(),
    };
  }

  /** Maps an edit path to a scope component via the component prefix maps. */
  private attributeComponent(path: string, scope: MutationScope): HarnessComponent {
    const normalized = path.split(sep).join("/");
    for (const component of scope.components) {
      const prefixes = this.componentPaths[component] ?? DEFAULT_COMPONENT_PATHS[component] ?? ["src/"];
      if (prefixes.some((prefix) => normalized === prefix || normalized.startsWith(prefix))) {
        return component;
      }
    }
    return scope.components[0];
  }

  /** Builds the confined, fs-backed worktree view for the agent. */
  private workspaceView(
    worktreePath: string,
    context: InspectTargetContext & { repoRoot?: string },
  ): AgentWorkspaceView {
    const root = worktreePath;
    const safe = (p: string): string | null => {
      if (!p || p.includes("..") || p.startsWith("/") || p.includes("\\")) return null;
      return join(root, ...p.split("/"));
    };
    return {
      worktreePath: root,
      repoRoot: context.repoRoot ?? root,
      parentCommit: context.parentCommit ?? "HEAD",
      readFile: async (p) => {
        const abs = safe(p);
        if (!abs) return null;
        try {
          return await readFile(abs, "utf8");
        } catch {
          return null;
        }
      },
      listFiles: async (prefix) => {
        const out: string[] = [];
        const walk = async (dir: string): Promise<void> => {
          let entries;
          try {
            entries = await readdir(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const entry of entries) {
            if (entry.name === ".git") continue;
            const abs = join(dir, entry.name);
            const rel = relative(root, abs).split(sep).join("/");
            if (entry.isDirectory()) {
              await walk(abs);
            } else if (entry.isFile()) {
              if (!prefix || rel.startsWith(prefix)) out.push(rel);
            }
          }
        };
        await walk(root);
        return out.sort();
      },
    };
  }
}

/**
 * Deterministic EngineeringAgentRuntime for tests, dry runs, and docs:
 * wraps a plain handler so a scripted "engineering agent" can inspect the
 * real worktree view (readFile/listFiles) and propose real edits without
 * any network or model dependency.
 */
export class ScriptedAgentRuntime implements EngineeringAgentRuntime {
  readonly name: string;
  private readonly handler: (request: AgentMutationRequest) => AgentMutationResponse | Promise<AgentMutationResponse>;

  constructor(
    name: string,
    handler: (request: AgentMutationRequest) => AgentMutationResponse | Promise<AgentMutationResponse>,
  ) {
    this.name = name;
    this.handler = handler;
  }

  proposeMutation(request: AgentMutationRequest): Promise<AgentMutationResponse> | AgentMutationResponse {
    return this.handler(request);
  }
}
