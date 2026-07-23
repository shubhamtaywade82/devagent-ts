import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { CliConfig, loadConfig } from "./config.js";
import { Provider, ChatMessage, ChatOptions, ChatResponse } from "../provider/provider.js";
import { Router } from "../provider/router.js";
import { Capability, inferCapabilities, ModelCatalog } from "../provider/catalog.js";
import { CheckpointStore, sanitizeResumedSteps } from "../runtime/checkpoint.js";
import { SessionStore, SessionMeta } from "../runtime/session.js";
import { LoopDetector } from "../orchestrator/loop-detector.js";
import { Orchestrator } from "../orchestrator/orchestrator.js";
import { AgentStepRunner } from "../orchestrator/agent-planner.js";
import { PlanStep, Planner } from "../orchestrator/types.js";
import { generatePlan, replanSteps } from "../tui/plan-generator.js";
import { SkillMeta } from "../skills/types.js";
import { LspServerState } from "../lsp/protocol.js";
import { ApprovalRequest, McpServerState, MissionPhase, MissionPhaseId } from "../runtime/types.js";
import { MemoryStore } from "../memory/store.js";
import { DocsStore } from "../docs/store.js";
import { generateSummary } from "../memory/summarizer.js";
import { AgentConversation } from "./agent-conversation.js";
import { AgentToolManager } from "./agent-tools.js";
import { AgentIntelligence } from "./agent-intelligence.js";
import { AgentLearning } from "./agent-learning.js";
import { DynamicToolSelector } from "../tools/discovery.js";
import { BrowserManager } from "../browser/manager.js";
import { BinanceStreamManager } from "../exchange/binance-stream.js";
// ── Hybrid local-cloud architecture ────────────────────────────────────
import { ModelAvailabilityChecker } from "../provider/availability.js";
import { KeyManager } from "../provider/key-manager.js";
import { HeuristicRouter } from "../provider/heuristic-router.js";
import { LocalWorker } from "../provider/local-worker.js";
import { Verifier } from "../provider/verifier.js";
import { SelfConsistency } from "../provider/self-consistency.js";
import { LOCAL_DELEGATION_SYSTEM_ADDENDUM } from "../tools/delegate-tool.js";

// Confirmation gate for irreversible actions — a UX safety net, not a
// security boundary (Docker sandboxing already bounds worst-case blast
// radius for run_shell). Deliberately targets the common, obvious cases
// rather than trying to be an exhaustive destructive-command detector.
const DESTRUCTIVE_SHELL_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*[rf]?[a-z]*(\s|$)/i, // rm -rf / -fr / -r -f, any flag order
  /\bgit\s+push\b.*(--force\b|-f\b)/i,
  /\bdrop\s+(table|database|schema)\b/i,
  /\btruncate\s+table\b/i,
  /\bmkfs\./i,
  />\s*\/dev\/sd[a-z]/i,
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/, // fork bomb
];

function classifyDestructive(name: string, args: Record<string, unknown>): { title: string; summary: string } | null {
  if (name === "delete_file") {
    const path = typeof args.path === "string" ? args.path : "(unknown path)";
    return { title: `Delete ${path}`, summary: `The agent wants to delete "${path}". This cannot be undone.` };
  }
  if (name === "run_shell") {
    const command = typeof args.command === "string" ? args.command : "";
    if (DESTRUCTIVE_SHELL_PATTERNS.some((p) => p.test(command))) {
      return { title: "Run destructive shell command", summary: command };
    }
  }
  return null;
}

export interface AgentEvents {
  onAssistantText?: (text: string) => void;
  onThinking?: (text: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: Record<string, unknown>) => void;
  onError?: (error: Error) => void;
  onStatus?: (status: string) => void;
  onShellOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
  onMemorySummary?: (summary: string) => void;
  onSkillsActivated?: (skills: SkillMeta[]) => void;
  onLspStateChange?: (servers: LspServerState[]) => void;
  onUsage?: (info: { promptTokens: number; completionTokens: number; tokensPerSecond: number; latencyMs: number }) => void;
  onPlanUpdate?: (goal: string, steps: PlanStep[], status: "running" | "completed" | "failed") => void;
  onApprovalRequested?: (request: ApprovalRequest) => void;
  onModelUsed?: (tier: string, model: string) => void;
  /** Whole-mission phase system (see runtime/mission-derive.ts): a new mission
   * begins, a phase's status changes, or a live plan step transitions. */
  onMissionStarted?: (goal: string) => void;
  onMissionPhase?: (id: MissionPhaseId, status: MissionPhase["status"]) => void;
  onMissionStep?: (step: PlanStep) => void;
}

type AgentEventName = keyof AgentEvents;
type AgentEventHandler<E extends AgentEventName> = NonNullable<AgentEvents[E]>;

export interface AgentOptions {
  config?: Partial<CliConfig>;
  events?: AgentEvents;
  skillsHomeDir?: string;
}

export class Agent {
  readonly conversation: AgentConversation;
  readonly tools: AgentToolManager;
  readonly intelligence: AgentIntelligence;
  readonly learning: AgentLearning;
  readonly memory: MemoryStore;
  readonly docs: DocsStore;
  readonly lspManager: AgentIntelligence["lspManager"];
  readonly railsIndex: AgentIntelligence["railsIndex"];
  readonly browser: BrowserManager;
  readonly binanceStream: BinanceStreamManager;
  private readonly toolSelector: DynamicToolSelector;

  private readonly provider: Provider;
  private readonly catalog: ModelCatalog;
  private readonly router: Router;
  private catalogRefreshed: Promise<void> | null = null;
  private readonly planCheckpoint: CheckpointStore;
  private readonly sessionStore: SessionStore;
  private currentSessionId = "";
  private readonly loopDetector = new LoopDetector();
  private readonly maxToolTurns = 128;
  readonly events: AgentEvents;
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  // ── Hybrid local-cloud architecture ─────────────────────────────────
  readonly heuristicRouter: HeuristicRouter | undefined;
  readonly localWorker: LocalWorker | undefined;
  readonly verifier: Verifier | undefined;
  readonly selfConsistency: SelfConsistency | undefined;
  readonly availabilityChecker: ModelAvailabilityChecker | undefined;
  readonly keyManager: KeyManager | undefined;
  private readonly mcpServerConfigs: Array<{ name: string; command: string; args?: string[] }>;
  private readonly pendingApprovals = new Map<string, (approved: boolean) => void>();

  constructor(opts: AgentOptions = {}) {
    const cfg = { ...loadConfig(), ...(opts.config ?? {}) };
    this.mcpServerConfigs = cfg.mcpServers ?? [];

    this.provider = new Provider({
      tier: cfg.tier,
      model: cfg.model,
      host: cfg.host,
      apiKey: cfg.apiKey,
      apiKeys: cfg.apiKeys,
      ...(cfg.timeoutMs ? { timeoutMs: cfg.timeoutMs } : {}),
    });

    // Separate provider pool for capability-routed delegation (see runUserMessage /
    // detectEscalationHint), kept independent of `this.provider` so the primary
    // conversation's model/tier is never mutated. Cloud provider is omitted
    // entirely when no API key is configured.
    const localProvider = new Provider({
      tier: "local",
      model: cfg.model,
      host: cfg.tier === "local" ? cfg.host : undefined,
      apiKeys: cfg.apiKeys,
      ...(cfg.timeoutMs ? { timeoutMs: cfg.timeoutMs } : {}),
    });
    const cloudProvider = cfg.apiKey
      ? new Provider({
          tier: "cloud",
          model: cfg.model,
          host: cfg.tier === "cloud" ? cfg.host : undefined,
          apiKey: cfg.apiKey,
          apiKeys: cfg.apiKeys,
          ...(cfg.timeoutMs ? { timeoutMs: cfg.timeoutMs } : {}),
        })
      : undefined;

    this.catalog = new ModelCatalog(localProvider, cloudProvider, cfg.quickModel);
    this.router = new Router({
      local: localProvider,
      cloud: cloudProvider,
      catalog: this.catalog,
      logger: { warn: (msg: string) => this.emit("onStatus", msg) },
    });

    // ── Hybrid local-cloud architecture: instantiate all components ─────────
    // Layer-1 gate: undefined when disabled, mirroring the other optional
    // hybrid components below (localWorker/verifier/selfConsistency).
    this.heuristicRouter = cfg.enableHeuristicGate ? new HeuristicRouter() : undefined;

    // Availability checker: pre-validate cloud model access per API key at startup.
    this.availabilityChecker =
      cfg.enableAvailabilityCheck && cfg.apiKeys?.length
        ? new ModelAvailabilityChecker(cfg.apiKeys, { ttlMs: cfg.availabilityCheckTtlMs })
        : undefined;

    // KeyManager: bind API keys to models to keep them warm in Ollama Cloud VRAM.
    this.keyManager =
      this.availabilityChecker && cfg.apiKeys?.length
        ? new KeyManager(cfg.apiKeys, this.availabilityChecker)
        : undefined;

    // LocalWorker: executes boilerplate tasks on the local quick model.
    // Uses a dedicated quick-model provider so the primary model/tier is never mutated.
    const quickLocalProvider = cfg.quickModel
      ? new Provider({
          tier: "local",
          model: cfg.quickModel,
          host: cfg.tier === "local" ? cfg.host : undefined,
        })
      : localProvider;
    this.localWorker = cfg.enableLocalWorker ? new LocalWorker(quickLocalProvider) : undefined;

    // Verifier: critic pass after local generation (off by default).
    this.verifier = cfg.enableVerifier && this.localWorker ? new Verifier(quickLocalProvider) : undefined;

    // Self-consistency: agreement signal for borderline prompts (off by default).
    this.selfConsistency =
      cfg.enableSelfConsistency
        ? new SelfConsistency(quickLocalProvider, {
            n: cfg.selfConsistencyN,
            threshold: cfg.selfConsistencyThreshold,
          })
        : undefined;

    // Trigger availability refresh non-blocking at startup.
    if (this.availabilityChecker) {
      this.availabilityChecker.refreshAll().catch((e: Error) =>
        this.emit("onStatus", `[Availability] refresh error: ${e.message}`),
      );
    }

    this.events = opts.events ?? {};

    this.conversation = new AgentConversation();

    this.tools = new AgentToolManager();
    this.tools.registerBaseTools(cfg.workspaceRoot, (stream, chunk) => this.emit("onShellOutput", stream, chunk));
    this.tools.registerHybridTools(this.localWorker);

    this.intelligence = new AgentIntelligence({
      workspaceRoot: cfg.workspaceRoot,
      languages: cfg.languages as
        Record<string, Partial<import("../lsp/registry.js").LanguageProviderConfig>> | undefined,
      lspConfig: cfg.lsp as import("../lsp/config.js").LspGlobalConfig | undefined,
      prewarm: (cfg.lsp as { prewarm?: string[] } | undefined)?.prewarm,
      onDiagnostics: (filePath, diagnostics) => {
        this.emit("onStatus", `diagnostics: ${filePath} (${diagnostics.length})`);
      },
      onServerStateChange: (servers) => {
        this.emit("onLspStateChange", servers);
      },
    });

    this.tools.registerLspTools(this.intelligence.lspManager);
    this.tools.registerRailsTools(this.intelligence.railsIndex);

    this.browser = new BrowserManager();
    this.tools.registerBrowserTools(this.browser);
    this.binanceStream = new BinanceStreamManager();
    this.tools.registerBinanceStreamTools(this.binanceStream);

    this.lspManager = this.intelligence.lspManager;
    this.railsIndex = this.intelligence.railsIndex;

    const devagentDir = join(cfg.workspaceRoot, ".devagent");
    mkdirSync(devagentDir, { recursive: true });

    this.memory = new MemoryStore(join(devagentDir, "memory.db"));
    this.planCheckpoint = new CheckpointStore(join(devagentDir, "checkpoint.json"));
    this.sessionStore = new SessionStore(join(devagentDir, "sessions"));
    this.currentSessionId = this.sessionStore.startNew();

    this.docs = new DocsStore(join(devagentDir, "docs.db"));
    this.tools.registerDocsTools(this.docs, cfg.workspaceRoot);

    const projectLanguage = this.intelligence.railsIndex.enabled
      ? this.intelligence.railsIndex.workspace.isRails
        ? "ruby"
        : this.intelligence.railsIndex.workspace.isRuby
          ? "ruby"
          : undefined
      : undefined;

    this.learning = new AgentLearning({
      workspaceRoot: cfg.workspaceRoot,
      provider: this.provider,
      memory: this.memory,
      skillsHomeDir: opts.skillsHomeDir,
      projectLanguage,
    });

    this.toolSelector = new DynamicToolSelector({
      mode: cfg.toolSelectionMode,
      maxActiveTools: cfg.maxActiveTools,
      provider: this.provider,
      // LLM-mode tool selection is a classification task, not a coding one — route it
      // through the "quick" capability (an always-resident local model, falling back
      // to cloud per Router.route/routeWithFallback) instead of the primary model.
      chat: async (messages) => {
        await this.ensureCatalog();
        const candidates = this.catalog.modelsFor("quick");
        if (candidates.length) {
          this.emit("onStatus", `delegating task to ${candidates[0].tier}/${candidates[0].name} (tool selection)`);
        }
        return this.routeWithFallback("quick", messages, { stream: false });
      },
    });
  }

  on<E extends AgentEventName>(event: E, handler: AgentEventHandler<E>): this {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler as (...args: unknown[]) => void);
    this.listeners.set(event, set);
    return this;
  }

  private emit<E extends AgentEventName>(event: E, ...args: Parameters<AgentEventHandler<E>>): void {
    if (event === "onToolCall") {
      this.learning.learning.recorder.onToolCall(args[0] as string, args[1] as Record<string, unknown>);
    } else if (event === "onToolResult") {
      this.learning.learning.recorder.onToolResult(args[0] as string, args[1] as Record<string, unknown>);
    } else if (event === "onError") {
      this.learning.learning.recorder.onError(args[0] as Error);
    }

    (this.events[event] as ((...a: typeof args) => void) | undefined)?.(...args);
    this.listeners.get(event)?.forEach((h) => h(...args));
  }

  async runUserMessage(userMessage: string, _priority?: PlanStep["priority"]): Promise<string> {
    const learnings = this.learning.getLearnings();
    const activatedSkills = this.learning.resolveForPrompt(userMessage);

    if (this.conversation.isEmpty()) {
      const cfg = loadConfig();
      this.conversation.init(cfg, learnings, activatedSkills);
    } else {
      const cfg = loadConfig();
      this.conversation.refreshSystemPrompt(cfg, learnings, activatedSkills);
    }

    for (const skill of activatedSkills) {
      this.conversation.injectSkill(skill);
    }
    if (activatedSkills.length) {
      this.emit(
        "onSkillsActivated",
        activatedSkills.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          tags: s.tags,
          version: s.version,
          scope: s.scope,
          dir: s.dir,
          path: s.path,
        })),
      );
    }

    this.learning.learning.recorder.begin(
      userMessage,
      activatedSkills.map((skill) => skill.id),
    );

    this.conversation.pushUserMessage(userMessage);
    this.learning.appendMessage("user", userMessage);

    let lastAssistantText = "";
    let success = true;
    let episodeEnded = false;
    const finish = (terminal: Parameters<typeof this.learning.learning.onEpisodeEnd>[0], text: string): string => {
      if (!episodeEnded) {
        this.learning.learning.onEpisodeEnd(terminal, text);
        episodeEnded = true;
      }
      // Persist the transcript after every turn (not just success) so a
      // killed/restarted process can resume with the model still remembering
      // this turn — mirrors the plan checkpoint's "save progress as you go".
      this.sessionStore.save(this.currentSessionId, this.conversation.getMessages());
      return text;
    };

    // priority no longer feeds routing (every turn now attempts "quick" first
    // unless the configured primary is cloud, see below) — kept as a
    // runUserMessage param for AgentStepRunner/Orchestrator interface
    // compatibility.
    const escalationHint = this.detectEscalationHint(userMessage);
    // Lookup-style prompts ("where is X defined?") NEED a tool call (search/read)
    // to answer correctly; a small model that just prose-answers instead is wrong,
    // not merely low-quality. Verified below: escalate once if that happens.
    const requiresToolEvidence = Agent.LOOKUP_PATTERN.test(userMessage.toLowerCase());
    // Local to this call, not a class field: AgentStepRunner reuses the same Agent
    // across plan steps and retries, each via a fresh runUserMessage call — a class
    // field would leak escalation state across unrelated steps/retries.
    // cfg.tier is never a silent default (config.ts falls back to "local" only
    // when nothing configures it) — "cloud" here always means the user
    // explicitly configured a cloud primary, which should be the real default
    // for the turn rather than trying "quick" first and hoping it's enough.
    let escalated = this.provider.currentTier === "cloud";
    let delegationAddendumInjected = false;
    const injectDelegationAddendum = () => {
      if (this.localWorker && !delegationAddendumInjected) {
        this.conversation.pushSystemMessage(LOCAL_DELEGATION_SYSTEM_ADDENDUM);
        delegationAddendumInjected = true;
      }
    };

    // Layer-1 heuristic gate: an explicit complexity trigger (debug/architecture/
    // proof/multi-step/etc.) skips the quick-model attempt entirely instead of
    // waiting for the quick model to discover it's out of its depth and call
    // escalate_task.
    if (this.heuristicRouter && !escalated) {
      const heuristic = this.heuristicRouter.classify(userMessage);
      if (heuristic.decision === "cloud") {
        escalated = true;
        injectDelegationAddendum();
        this.emit(
          "onStatus",
          `escalating to primary model: heuristic pre-filter matched "${heuristic.trigger}"`,
        );
      } else if (heuristic.decision === "unknown" && !requiresToolEvidence && this.selfConsistency) {
        // Self-consistency, not verbalized self-confidence: measures agreement
        // across independent samples rather than asking the model to judge its
        // own output (that approach was tried and rejected — see the comment
        // above requiresToolEvidence's verifyingLookup/verifyingRecovery usage).
        const sc = await this.selfConsistency.evaluate(userMessage);
        if (sc.shouldEscalate) {
          escalated = true;
          injectDelegationAddendum();
          this.emit(
            "onStatus",
            `escalating to primary model: low self-consistency agreement (${sc.score.toFixed(2)})`,
          );
        }
      }
    }

    // Needed regardless of which capability answers this turn — e.g. a
    // direct this.provider.chat call (capability null) never goes through
    // routeWithFallback's own ensureCatalog, but DynamicToolSelector's
    // hybrid-mode tool-selection classification (line ~284) still reads
    // this.catalog.modelsFor("quick").
    await this.ensureCatalog();

    // Set at the end of a turn's tool dispatch when any tool call in that turn
    // errored; read at the top of the NEXT turn's buffering decision, then reset —
    // see the "recoveredFromError"/verifying logic below.
    let previousTurnHadToolError = false;

    try {
      for (let toolTurn = 0; toolTurn < this.maxToolTurns; toolTurn++) {
        this.conversation.pruneContext();
        this.emit("onStatus", `turn ${toolTurn + 1}`);

        const capability: Capability | null = escalated ? escalationHint : "quick";

        const activeTools = await this.toolSelector.selectTools(
          userMessage,
          this.conversation.getMessages(),
          this.tools.registry.getTools(),
        );
        // escalate_task must always be offered while still on the local model —
        // heuristic/LLM tool-selection scoring could otherwise leave it out.
        if (!escalated && !activeTools.some((t) => t.name === "escalate_task")) {
          const escalateTool = this.tools.registry.getTools().find((t) => t.name === "escalate_task");
          if (escalateTool) activeTools.push(escalateTool);
        }
        // Symmetric: delegate_to_local must always be offered once escalated —
        // it's the primary model's way to push boilerplate back down instead of
        // spending its own tokens on it.
        if (escalated && this.localWorker && !activeTools.some((t) => t.name === "delegate_to_local")) {
          const delegateTool = this.tools.registry.getTools().find((t) => t.name === "delegate_to_local");
          if (delegateTool) activeTools.push(delegateTool);
        }

        // Buffer the attempt's streamed text instead of emitting it live, so a bad
        // quick-model answer can be discarded and re-run on the primary model
        // without ever hitting the UI. Two triggers: (1) a lookup-phrased question
        // answered without the required tool call, turn 0 only; (2) the PREVIOUS
        // turn's tool call errored and the quick model — instead of retrying or
        // calling escalate_task — is about to answer anyway (observed in practice:
        // a 1B model inventing an unrelated "fix" or apologizing instead of
        // escalating). Only while still unescalated; the recovery check consumes
        // and resets previousTurnHadToolError so it never leaks past this turn.
        //
        // Deliberately NOT extended to a general "self-confidence probe" for
        // plain wrong-but-confident final answers (e.g. a hard task answered
        // wrong in one shot, no error, no loop) — tried it, tested it live
        // against real minicpm5-1b: the model just says "yes I'm confident" to
        // its own garbage. A weak model's self-assessment of its own output
        // isn't trustworthy, so there's no cheap fix for that failure mode here;
        // it's an accepted residual risk (see escalate-on-hard-task benchmark
        // case in src/benchmark/cases-agentic.ts, which stays red on purpose).
        const verifyingLookup = requiresToolEvidence && toolTurn === 0 && !escalated;
        const verifyingRecovery = !escalated && previousTurnHadToolError;
        previousTurnHadToolError = false;
        const verifying = verifyingLookup || verifyingRecovery;
        let buffered: string[] | null = verifying ? [] : null;
        const makeChatOpts = () => ({
          stream: true,
          tools: activeTools.length > 0 ? activeTools.map((t) => t.schema) : undefined,
          onChunk: (chunk: any) => {
            const delta = chunk.message?.content;
            if (typeof delta === "string" && delta) {
              if (buffered) buffered.push(delta);
              else {
                lastAssistantText += delta;
                this.emit("onAssistantText", delta);
              }
            }
            const thinking = (chunk.message as any)?.thinking;
            if (typeof thinking === "string" && thinking) {
              this.emit("onThinking", thinking);
            }
          },
        });
        let chatOpts = makeChatOpts();
        const turnStart = Date.now();
        let chatResponse = capability
          ? await this.routeWithFallback(capability, this.conversation.getMessages(), chatOpts)
          : await this.provider.chat(this.conversation.getMessages(), chatOpts);

        let assistantMessage = chatResponse.message as {
          content?: string;
          tool_calls?: Array<{ function: { name: string; arguments: any } }>;
        };

        if (verifying && !(assistantMessage.tool_calls ?? []).length) {
          this.emit(
            "onStatus",
            verifyingRecovery
              ? "escalating to primary model: previous tool call failed and the quick model answered instead of retrying or escalating"
              : "escalating to primary model: quick model answered a lookup query without calling a tool",
          );
          escalated = true;
          injectDelegationAddendum();
          buffered = null;
          chatOpts = makeChatOpts();
          chatResponse = await this.provider.chat(this.conversation.getMessages(), chatOpts);
          assistantMessage = chatResponse.message as {
            content?: string;
            tool_calls?: Array<{ function: { name: string; arguments: any } }>;
          };
        } else if (buffered) {
          for (const delta of buffered) {
            lastAssistantText += delta;
            this.emit("onAssistantText", delta);
          }
        }

        // Router.route can silently widen its candidate pool past whatever
        // capability was requested (e.g. "quick" resolving to a cloud model
        // when no local model reports tool support) — routedTier/routedModel
        // reflect what actually answered; the direct this.provider.chat path
        // (capability null) has no Router involved, so fall back to the
        // provider's own current tier/model there.
        const routedTier = (chatResponse.routedTier as string | undefined) ?? this.provider.currentTier;
        const routedModel = (chatResponse.routedModel as string | undefined) ?? this.provider.currentModel;
        this.emit("onModelUsed", routedTier, routedModel);

        this.emitUsage(chatResponse, Date.now() - turnStart);
        this.conversation.pushAssistantMessage(assistantMessage.content ?? "", assistantMessage.tool_calls);

        const toolCalls = assistantMessage.tool_calls ?? [];
        const hasContent = (assistantMessage.content ?? "").trim().length > 0;

        if (!toolCalls.length) {
          if (hasContent) {
            this.learning.appendMessage("assistant", lastAssistantText);
            this.triggerSummarization();
            return finish("answered", lastAssistantText);
          }
          if (toolTurn < this.maxToolTurns - 1) {
            this.conversation.pushSystemMessage(
              "[system] You were thinking but produced no action or response. Please continue toward the goal: call a tool or provide your final answer now.",
            );
            continue;
          }
          return finish("answered", lastAssistantText || "(no response)");
        }

        for (const toolCall of toolCalls) {
          const name = toolCall.function.name;
          const rawArguments = toolCall.function.arguments;
          let args: Record<string, unknown> = {};

          if (typeof rawArguments === "object" && rawArguments !== null) {
            args = rawArguments as Record<string, unknown>;
          } else if (typeof rawArguments === "string" && rawArguments) {
            try {
              args = JSON.parse(rawArguments);
            } catch {
              // leave args empty on malformed JSON
            }
          }

          this.emit("onToolCall", name, args);

          const destructive = classifyDestructive(name, args);
          if (destructive && !(await this.requestApproval(destructive.title, destructive.summary))) {
            const rejected = { error: "ApprovalRejected", message: "The user rejected this action." };
            this.conversation.pushToolResult(JSON.stringify(rejected, null, 2));
            this.emit("onToolResult", name, rejected);
            previousTurnHadToolError = true;
            continue;
          }

          try {
            const result = await this.tools.registry.invoke(name, args);

            if (result.error === "PathEscapeError") {
              this.conversation.pushToolResult(
                JSON.stringify({ error: "PathEscapeError", message: result.message }, null, 2),
              );
              this.emit("onToolResult", name, result);
              this.conversation.pushSystemMessage(
                "[system] The previous tool call escaped the workspace root. Retry with a path under the current workspace root.",
              );
              previousTurnHadToolError = true;

              if (typeof result.error === "string" && this.loopDetector.record(name, args, result.error)) {
                return finish(
                  "loop_abort",
                  lastAssistantText + "\n[aborted] tool loop detected after repeated escapes.",
                );
              }
              continue;
            }

            this.emit("onToolResult", name, result);
            this.intelligence.feedRailsIndex(name, args, result);
            this.conversation.pushToolResult(typeof result === "string" ? result : JSON.stringify(result, null, 2));

            if (name === "escalate_task" && result.escalate === true) {
              escalated = true;
              injectDelegationAddendum();
              this.emit("onStatus", `escalating to ${escalationHint ?? "the primary model"}: ${result.reason}`);
            }

            if (typeof result.error === "string") {
              previousTurnHadToolError = true;
              if (this.loopDetector.record(name, args, result.error)) {
                return finish("loop_abort", lastAssistantText + "\n[aborted] tool loop detected after repeated: " + name);
              }
            }
            if (toolTurn === this.maxToolTurns - 1) {
              return finish("turn_budget", lastAssistantText || "(no response)");
            }
          } catch (e) {
            const err = e as Error;
            this.emit("onError", err);
            this.conversation.pushToolResult(
              JSON.stringify({ error: err.constructor.name, message: err.message }, null, 2),
            );
            previousTurnHadToolError = true;
          }
        }
      }

      return finish("turn_budget", lastAssistantText || "(tool budget exceeded)");
    } catch (e) {
      success = false;
      finish("error", lastAssistantText);
      throw e;
    } finally {
      for (const skill of activatedSkills) this.learning.recordSkillUse(skill.id, success);
    }
  }

  pinSkill(id: string | null): void {
    this.learning.pinSkill(id);
  }

  getSkillsRegistry() {
    return this.learning.getSkillsRegistry();
  }

  flushLearning(): Promise<void> {
    return this.learning.flushLearning();
  }

  async runPlannedTask(steps: PlanStep[], planner: Planner): Promise<PlanStep[]> {
    const orchestrator = new Orchestrator({
      steps,
      runner: new AgentStepRunner(this),
      planner,
      runRollback: async (command: string) => {
        await this.runUserMessage(`Roll back by running exactly this: ${command}`);
      },
      checkpoint: this.planCheckpoint,
      onStepChange: (step) => this.emit("onMissionStep", step),
    });
    return orchestrator.run();
  }

  /**
   * Resume a plan interrupted by a crash or kill. Returns null if no
   * checkpoint exists (nothing to resume). Non-terminal step statuses are
   * reset to "pending" — the process died mid-step, so its outcome is unknown.
   */
  async resumePlannedTask(planner: Planner): Promise<PlanStep[] | null> {
    const saved = this.planCheckpoint.load();
    if (!saved) return null;

    const orchestrator = new Orchestrator({
      steps: sanitizeResumedSteps(saved.steps),
      runner: new AgentStepRunner(this),
      planner,
      runRollback: async (command: string) => {
        await this.runUserMessage(`Roll back by running exactly this: ${command}`);
      },
      checkpoint: this.planCheckpoint,
      onStepChange: (step) => this.emit("onMissionStep", step),
    });
    return orchestrator.run();
  }

  hasResumablePlan(): boolean {
    return this.planCheckpoint.load() !== null;
  }

  /** Pauses until the TUI resolves the request (approve/reject keypress).
   * The ApprovalOverlay/approval.requested plumbing already existed on the
   * TUI side but had no producer — this is that producer. */
  private async requestApproval(title: string, summary: string): Promise<boolean> {
    const id = `appr${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    const request: ApprovalRequest = { id, title, summary, filesChanged: 0, additions: 0, deletions: 0 };
    const approved = await new Promise<boolean>((resolve) => {
      this.pendingApprovals.set(id, resolve);
      this.emit("onApprovalRequested", request);
    });
    this.pendingApprovals.delete(id);
    return approved;
  }

  /** Called by the TUI when the user presses approve/reject on a pending request. */
  resolveApproval(id: string, approved: boolean): void {
    this.pendingApprovals.get(id)?.(approved);
  }

  /** Entry point for /plan: decomposes `goal` into steps via the model, then
   * runs them through the real Orchestrator (topological + concurrent
   * execution, retry, model-driven replan on failure, rollback) — not a
   * canned "write me a plan" chat message. Resumes an interrupted plan
   * instead of starting a new one when `goal` is empty and a checkpoint
   * exists. */
  async runPlan(goal: string): Promise<PlanStep[]> {
    const planner: Planner = { replan: (remaining, history) => replanSteps(remaining, history, this.provider) };

    if (!goal.trim() && this.hasResumablePlan()) {
      // Understand/Inspect have no distinct signal of their own (both happen
      // inside ordinary tool-call exploration before /plan is invoked) — mark
      // them completed the instant Plan starts rather than fabricate a fake
      // boundary between them. See runtime/types.ts's MissionState doc comment.
      this.emit("onMissionStarted", "(resumed plan)");
      this.emit("onMissionPhase", "understand", "completed");
      this.emit("onMissionPhase", "inspect", "completed");
      this.emit("onMissionPhase", "plan", "completed");
      this.emit("onMissionPhase", "execute", "running");
      const resumed = await this.resumePlannedTask(planner);
      if (resumed) {
        const failed = resumed.some((s) => s.status === "failed");
        this.emit("onMissionPhase", "execute", failed ? "failed" : "completed");
        this.emit("onMissionPhase", "complete", failed ? "failed" : "completed");
        this.emit("onPlanUpdate", "(resumed plan)", resumed, failed ? "failed" : "completed");
        return resumed;
      }
    }

    this.emit("onMissionStarted", goal);
    this.emit("onMissionPhase", "understand", "completed");
    this.emit("onMissionPhase", "inspect", "completed");
    this.emit("onMissionPhase", "plan", "running");
    const steps = await generatePlan(goal, this.provider);
    this.emit("onMissionPhase", "plan", "completed");
    this.emit("onPlanUpdate", goal, steps, "running");
    this.emit("onMissionPhase", "execute", "running");
    const finalSteps = await this.runPlannedTask(steps, planner);
    const failed = finalSteps.some((s) => s.status === "failed");
    this.emit("onMissionPhase", "execute", failed ? "failed" : "completed");
    this.emit("onMissionPhase", "complete", failed ? "failed" : "completed");
    this.emit("onPlanUpdate", goal, finalSteps, failed ? "failed" : "completed");
    return finalSteps;
  }

  setModel(model: string): void {
    this.provider.setModel(model);
    this.conversation.reset();
  }

  setModelWithoutReset(model: string): void {
    this.provider.setModel(model);
  }

  // ponytail: keyword classification, not an LLM intent classifier — cheap and
  // deterministic. No longer gates whether the local "quick" model gets tried
  // at all (every turn attempts it first, unless the configured primary is
  // cloud — see runUserMessage's `escalated` initializer) — these patterns
  // only pick the ESCALATION TARGET for when the model self-escalates via the
  // escalate_task tool, reusing Router's existing vision/reasoning routing.
  private static readonly VISION_PATTERN = /\b(screenshot|diagram|image|photo|picture)\b|\.(png|jpe?g|gif|webp)\b/;
  private static readonly REASONING_PATTERN =
    /\b(architecture|trade-?offs?|root cause|design decision|why does|why is|think through|deep dive)\b/;
  // Read-only lookup/classification phrasing — still used below to require tool
  // evidence on quick-routed lookup turns (a prose-only answer is wrong, not
  // just low quality).
  private static readonly LOOKUP_PATTERN =
    /\b(where is|where's|find the|show me|list the|which file|how many|what does .* do)\b/;

  private detectEscalationHint(text: string): "vision" | "reasoning" | null {
    const desc = text.toLowerCase();
    if (Agent.VISION_PATTERN.test(desc)) return "vision";
    if (Agent.REASONING_PATTERN.test(desc)) return "reasoning";
    return null;
  }

  // Refreshed once, on first delegation attempt, and cached for the Agent's lifetime.
  private ensureCatalog(): Promise<void> {
    if (!this.catalogRefreshed) {
      this.catalogRefreshed = this.catalog.refresh().then(() => undefined);
    }
    return this.catalogRefreshed;
  }

  /**
   * Routes through Router.route for the given capability (which already
   * widens "quick" to any cloud candidate when no local one is available —
   * see Router.route), and falls back to the primary provider/model if
   * routing still fails outright (e.g. neither local nor cloud has any
   * candidate at all). This is the guarantee that a capability-delegated
   * turn — e.g. the always-resident local "quick" model being unpulled,
   * unreachable, or crashed — never breaks the turn, only skips delegation.
   */
  private async routeWithFallback(
    capability: Capability,
    messages: ChatMessage[],
    opts?: ChatOptions,
  ): Promise<ChatResponse> {
    await this.ensureCatalog();
    try {
      return await this.router.route(capability, messages, opts);
    } catch {
      return this.provider.chat(messages, opts);
    }
  }

  addLearning(category: string, context: string, lesson: string): void {
    this.learning.addLearning(category, context, lesson);
  }

  async validateModel(): Promise<true | string> {
    try {
      await this.provider.chat([{ role: "user", content: "respond with just a single dot" }], { stream: false });
      return true;
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (msg.includes("403") && msg.includes("subscription")) {
        return "requires a subscription — upgrade at https://ollama.com/upgrade";
      }
      return `unreachable: ${msg}`;
    }
  }

  setTier(tier: string): void {
    this.provider.setTier(tier as any);
  }

  setRuntimeHost(host: string): void {
    this.provider.setRuntimeHost(host);
  }

  get currentModel(): string {
    return this.provider.currentModel;
  }

  get currentTier(): string {
    return this.provider.currentTier;
  }

  async listModels(): Promise<string[]> {
    const data = await this.provider.availableModels();
    if (this.provider.currentTier === "cloud") {
      const cloud = data as { data?: Array<{ id: string }> };
      return (cloud.data ?? []).map((m) => m.id);
    }
    const local = data as { models?: Array<{ name: string }> };
    return (local.models ?? []).map((m) => m.name);
  }

  /**
   * Cache-only availability lookup for the model switcher: which of `models`
   * are known (from the startup/background ModelAvailabilityChecker refresh)
   * to require an Ollama Cloud subscription, so the picker can show that
   * before the user selects one instead of after. Models never checked yet,
   * or local-tier models (the checker only tracks cloud), are omitted rather
   * than guessed at.
   */
  modelAvailability(models: string[]): Record<string, boolean> {
    if (!this.availabilityChecker) return {};
    const out: Record<string, boolean> = {};
    for (const m of models) {
      const status = this.availabilityChecker.cachedStatusAnyKey(m);
      if (status) out[m] = status.available;
    }
    return out;
  }

  /**
   * Per-model capability tags (coding/vision/reasoning/quick/tools/agentic)
   * for the model switcher. Local models get real capabilities reported by
   * Ollama's /api/tags; cloud models fall back to the same name-based
   * heuristic used for routing (`inferCapabilities`) since Cloud's
   * OpenAI-compatible /v1/models doesn't expose capability metadata.
   */
  async modelCapabilities(models: string[]): Promise<Record<string, Capability[]>> {
    await this.ensureCatalog();
    const byName = new Map(this.catalog.all().map((m) => [m.name, m.capabilities]));
    const out: Record<string, Capability[]> = {};
    for (const m of models) out[m] = byName.get(m) ?? inferCapabilities(m);
    return out;
  }

  resetContext(): void {
    this.conversation.reset();
    this.sessionStore.clear(this.currentSessionId);
    this.currentSessionId = this.sessionStore.startNew();
  }

  hasResumableSession(): boolean {
    return this.sessionStore.mostRecentId() !== null;
  }

  /** Lists past conversations, most recently updated first, for a session
   * history picker. */
  listSessions(): SessionMeta[] {
    return this.sessionStore.listSessions();
  }

  /** Restores the most recently persisted conversation transcript, e.g. after
   * a crash/restart. Returns the restored messages (for replaying into the
   * TUI's visible chat log) or null if there was nothing to resume. */
  resumeSession(): ChatMessage[] | null {
    const id = this.sessionStore.mostRecentId();
    return id ? this.resumeSessionById(id) : null;
  }

  /** Restores a specific past conversation by session id, e.g. from the
   * session history picker. */
  resumeSessionById(id: string): ChatMessage[] | null {
    const saved = this.sessionStore.load(id);
    if (!saved) return null;
    this.currentSessionId = id;
    this.conversation.loadMessages(saved);
    return saved;
  }

  // Ollama's /api/chat response carries eval_count/prompt_eval_count/eval_duration
  // (nanoseconds) untyped through ChatResponse's index signature — read them here
  // rather than widening the shared type for fields only this call site needs.
  private emitUsage(response: { [key: string]: unknown }, latencyMs: number): void {
    const promptTokens = response.prompt_eval_count as number | undefined;
    const completionTokens = response.eval_count as number | undefined;
    const evalDurationNs = response.eval_duration as number | undefined;
    if (typeof promptTokens !== "number" && typeof completionTokens !== "number") return;
    const tokensPerSecond =
      typeof completionTokens === "number" && typeof evalDurationNs === "number" && evalDurationNs > 0
        ? completionTokens / (evalDurationNs / 1e9)
        : 0;
    this.emit("onUsage", {
      promptTokens: promptTokens ?? 0,
      completionTokens: completionTokens ?? 0,
      tokensPerSecond,
      latencyMs,
    });
  }

  private isSummarizing = false;

  private triggerSummarization(): void {
    if (this.isSummarizing) return;
    this.isSummarizing = true;
    // Routed through "quick" rather than this.provider (the conversation's
    // own primary model): this fires fire-and-forget right after every turn,
    // and previously shared the exact same provider/endpoint/connection as
    // the very next turn's own request — the two would contend for the same
    // queue, making whichever turn came quickly after a short exchange (a
    // greeting, say) queue behind the still-in-flight background summary
    // call and appear to hang. "quick" is also simply the right tier for a
    // 3-5 bullet summary — no need for the primary model's full capability.
    generateSummary(this.memory, { chat: (messages, opts) => this.routeWithFallback("quick", messages, opts) })
      .then((summary) => this.emit("onMemorySummary", summary))
      .catch((e) => this.emit("onError", e instanceof Error ? e : new Error(String(e))))
      .finally(() => {
        this.isSummarizing = false;
      });
  }

  getRegistry() {
    return this.tools.registry;
  }

  async registerMcpServer(command: string, args: string[] = []): Promise<void> {
    await this.tools.registerMcpServer(command, args);
  }

  /** Connects every MCP server listed in config.mcpServers, one at a time
   * (each spawns a subprocess). Never throws — a server that fails to start
   * shows up as `connected: false` rather than aborting the others or the
   * TUI's own startup. */
  async connectConfiguredMcpServers(): Promise<McpServerState[]> {
    const results: McpServerState[] = [];
    for (const server of this.mcpServerConfigs) {
      const start = Date.now();
      try {
        const tools = await this.tools.registerMcpServer(server.command, server.args ?? []);
        results.push({
          name: server.name,
          connected: true,
          latencyMs: Date.now() - start,
          tools: tools.map((t) => t.name),
          errors: 0,
        });
      } catch {
        results.push({ name: server.name, connected: false, latencyMs: Date.now() - start, tools: [], errors: 1 });
      }
    }
    return results;
  }
}
