import { Provider, ChatMessage, ChatResponse, Tier } from "../provider/provider.js";
import { AgenticBenchmarkCase, AgenticTrajectory, BenchmarkCase, BenchmarkResult, SingleTurnBenchmarkCase } from "./types.js";

export interface BenchmarkTarget {
  model: string;
  tier: Tier;
  provider: Provider;
}

interface CaseRunOutcome {
  pass: boolean;
  reason?: string;
  tokensPerSec: number | null;
}

// A plain array is reused as-is for every target. A factory is called fresh
// per target — required for any case whose `resolveTool` closes over mutable
// state (e.g. "error on the first call, succeed after"): without a fresh
// closure per target, that state would otherwise leak across different
// models' runs of the same case object.
export async function runBenchmark(
  targets: BenchmarkTarget[],
  cases: BenchmarkCase[] | (() => BenchmarkCase[]),
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  for (const target of targets) {
    target.provider.setModel(target.model);
    target.provider.setTier(target.tier);

    const caseList = typeof cases === "function" ? cases() : cases;
    for (const testCase of caseList) {
      const start = Date.now();
      try {
        const outcome =
          testCase.kind === "agentic"
            ? await runAgenticTurn(target, testCase)
            : await runSingleTurn(target, testCase);
        results.push({
          model: target.model,
          tier: target.tier,
          caseId: testCase.id,
          category: testCase.category,
          latencyMs: Date.now() - start,
          ...outcome,
        });
      } catch (e) {
        results.push({
          model: target.model,
          tier: target.tier,
          caseId: testCase.id,
          category: testCase.category,
          pass: false,
          latencyMs: Date.now() - start,
          tokensPerSec: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  return results;
}

async function runSingleTurn(target: BenchmarkTarget, testCase: SingleTurnBenchmarkCase): Promise<CaseRunOutcome> {
  const start = Date.now();
  const response = await target.provider.chat(testCase.messages, {
    tools: testCase.tools,
    stream: false,
  });
  const { pass, reason } = testCase.validate(response);
  return { pass, reason, tokensPerSec: estimateTokensPerSec(response, Date.now() - start) };
}

// Standalone ReAct-style loop, deliberately not reusing Agent.runUserMessage —
// no conversation pruning, no capability routing, no tool registry side effects
// beyond what the case's own `resolveTool` does. Mirrors the shape of the real
// agent loop (src/cli/agent.ts) closely enough that findings here transfer.
async function runAgenticTurn(target: BenchmarkTarget, testCase: AgenticBenchmarkCase): Promise<CaseRunOutcome> {
  const start = Date.now();
  const messages: ChatMessage[] = [...testCase.messages];
  const toolCallsMade: AgenticTrajectory["toolCallsMade"] = [];
  let finalContent = "";
  let hitMaxTurns = true;
  let turns = 0;
  let lastResponse: ChatResponse | undefined;

  for (; turns < testCase.maxTurns; turns++) {
    const response = await target.provider.chat(messages, { tools: testCase.tools, stream: false });
    lastResponse = response;
    const assistantMessage = response.message as {
      content?: string;
      tool_calls?: Array<{ function: { name: string; arguments: unknown } }>;
    };
    messages.push({
      role: "assistant",
      content: assistantMessage.content ?? "",
      tool_calls: assistantMessage.tool_calls,
    });

    const toolCalls = assistantMessage.tool_calls ?? [];
    if (!toolCalls.length) {
      finalContent = assistantMessage.content ?? "";
      hitMaxTurns = false;
      break;
    }

    for (const call of toolCalls) {
      const name = call.function.name;
      const rawArgs = call.function.arguments;
      const args =
        typeof rawArgs === "object" && rawArgs !== null
          ? (rawArgs as Record<string, unknown>)
          : typeof rawArgs === "string"
            ? (tryParseJson(rawArgs) ?? {})
            : {};
      const result = await testCase.resolveTool(name, args);
      toolCallsMade.push({ name, args, result });
      messages.push({ role: "tool", content: JSON.stringify(result) });
    }
  }

  const trajectory: AgenticTrajectory = { finalContent, toolCallsMade, turns, hitMaxTurns };
  const { pass, reason } = testCase.validate(trajectory);
  return {
    pass,
    reason,
    tokensPerSec: lastResponse ? estimateTokensPerSec(lastResponse, Date.now() - start) : null,
  };
}

function tryParseJson(text: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Ollama's /api/chat response includes eval_count/eval_duration (ns) on the
// final chunk when available; fall back to a rough content-length estimate
// (~4 chars/token) when a provider doesn't report them.
function estimateTokensPerSec(response: ChatResponse, latencyMs: number): number | null {
  const evalCount = response.eval_count as number | undefined;
  const evalDurationNs = response.eval_duration as number | undefined;
  if (typeof evalCount === "number" && typeof evalDurationNs === "number" && evalDurationNs > 0) {
    return evalCount / (evalDurationNs / 1e9);
  }
  if (latencyMs <= 0) return null;
  const content = response.message?.content ?? "";
  const estimatedTokens = content.length / 4;
  return estimatedTokens / (latencyMs / 1000);
}
