import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { CliConfig, loadConfig } from "./config.js";
import { Provider, ChatMessage, ChatOptions, ChatResponse } from "../provider/provider.js";
import { Router } from "../provider/router.js";
import { Capability, ModelCatalog } from "../provider/catalog.js";
import { CheckpointStore, sanitizeResumedSteps } from "../runtime/checkpoint.js";
import { SessionStore } from "../runtime/session.js";
import { LoopDetector } from "../orchestrator/loop-detector.js";
import { Orchestrator } from "../orchestrator/orchestrator.js";
import { AgentStepRunner } from "../orchestrator/agent-planner.js";
import { PlanStep, Planner } from "../orchestrator/types.js";
import { SkillMeta } from "../skills/types.js";
import { LspServerState } from "../lsp/protocol.js";
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

  constructor(opts: AgentOptions = {}) {
    const cfg = { ...loadConfig(), ...(opts.config ?? {}) };

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
    this.sessionStore = new SessionStore(join(devagentDir, "session.json"));

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
      this.sessionStore.save(this.conversation.getMessages());
      return text;
    };

    // priority no longer feeds routing (every turn now attempts "quick" first,
    // see below) — kept as a runUserMessage param for AgentStepRunner/Orchestrator
    // interface compatibility.
    const escalationHint = this.detectEscalationHint(userMessage);
    // Lookup-style prompts ("where is X defined?") NEED a tool call (search/read)
    // to answer correctly; a small model that just prose-answers instead is wrong,
    // not merely low-quality. Verified below: escalate once if that happens.
    const requiresToolEvidence = Agent.LOOKUP_PATTERN.test(userMessage.toLowerCase());
    // Local to this call, not a class field: AgentStepRunner reuses the same Agent
    // across plan steps and retries, each via a fresh runUserMessage call — a class
    // field would leak escalation state across unrelated steps/retries.
    let escalated = false;
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
    if (this.heuristicRouter) {
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

    await this.ensureCatalog();
    const quickCandidates = this.catalog.modelsFor("quick");
    if (quickCandidates.length) {
      this.emit("onStatus", `delegating task to ${quickCandidates[0].tier}/${quickCandidates[0].name}`);
    }

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
    });
    return orchestrator.run();
  }

  hasResumablePlan(): boolean {
    return this.planCheckpoint.load() !== null;
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
  // at all (every turn attempts it first, see runUserMessage) — these patterns
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

  resetContext(): void {
    this.conversation.reset();
    this.sessionStore.clear();
  }

  hasResumableSession(): boolean {
    return this.sessionStore.load() !== null;
  }

  /** Restores a persisted conversation transcript, e.g. after a crash/restart.
   * Returns the restored messages (for replaying into the TUI's visible chat
   * log) or null if there was nothing to resume. */
  resumeSession(): ChatMessage[] | null {
    const saved = this.sessionStore.load();
    if (!saved) return null;
    this.conversation.loadMessages(saved);
    return saved;
  }

  private isSummarizing = false;

  private triggerSummarization(): void {
    if (this.isSummarizing) return;
    this.isSummarizing = true;
    generateSummary(this.memory, this.provider)
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
}
