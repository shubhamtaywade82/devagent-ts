import React from "react";
import { Box, Text } from "ink";
import { ChatEntry, RuntimeState } from "../../runtime/types.js";
import { ViewProps } from "./ConversationView.js";

interface ContextBreakdown {
  conversationChars: number;
  toolChars: number;
  otherChars: number;
  totalChars: number;
}

// Ollama only reports an aggregate token count for the whole request, never a
// per-message breakdown — so this splits by character count (a rough 4-chars-
// per-token proxy) among what's actually in the visible transcript. Real
// total, estimated split; always labeled as such in the UI.
function estimateContextBreakdown(state: RuntimeState): ContextBreakdown {
  let conversationChars = 0;
  let toolChars = 0;
  let otherChars = 0;

  for (const entry of state.conversation) {
    if (entry.kind === "text") {
      conversationChars += entry.text.length;
    } else if (entry.kind === "tool_call") {
      toolChars += JSON.stringify(entry.args).length + (entry.result?.length ?? 0) + (entry.error?.length ?? 0);
    } else {
      otherChars += otherEntryChars(entry);
    }
  }
  return { conversationChars, toolChars, otherChars, totalChars: conversationChars + toolChars + otherChars };
}

function otherEntryChars(entry: ChatEntry): number {
  switch (entry.kind) {
    case "plan":
      return entry.steps.reduce((s, step) => s + step.description.length, 0);
    case "decision":
      return entry.reason.length + entry.selected.length;
    case "diff_preview":
      return entry.diff.length;
    case "test_result":
      return entry.failures.reduce((s, f) => s + f.message.length, 0);
    case "card":
      return entry.items.reduce((s, i) => s + i.label.length + (i.detail?.length ?? 0), 0);
    default:
      return 0;
  }
}

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function ContextInspectorView({ state, width, rows }: ViewProps): React.JSX.Element {
  const { model, memory, execution } = state;

  const hasLimit = model.contextLimit > 0;
  const contextPercent = hasLimit ? Math.round((model.contextUsed / model.contextLimit) * 100) : null;
  const contextColor = contextPercent === null ? "gray" : contextPercent > 80 ? "red" : contextPercent > 60 ? "yellow" : "green";
  const breakdown = estimateContextBreakdown(state);

  return (
    <Box flexDirection="column" height={rows}>
      <Box height={1} marginBottom={1}>
        <Text bold>Context Inspector</Text>
      </Box>

      <Box height={1}>
        <Text bold>Token Usage</Text>
      </Box>
      <Box height={1} marginLeft={2}>
        <Text>
          <Text>Used: </Text>
          <Text color={contextColor}>{model.contextUsed.toLocaleString()}</Text>
          <Text color="gray"> / {hasLimit ? model.contextLimit.toLocaleString() : "unknown"}</Text>
        </Text>
      </Box>
      <Box height={1} marginLeft={2}>
        <Text>
          <Text>Usage: </Text>
          <Text color={contextColor}>{contextPercent === null ? "no known context window for this model" : `${contextPercent}%`}</Text>
        </Text>
      </Box>
      <Box height={1} marginLeft={2}>
        <Text>
          <Text>Speed: </Text>
          <Text color="gray">{model.tokensPerSecond.toFixed(1)} tok/s</Text>
          {model.latencyMs > 0 && <Text color="gray">  Latency: {model.latencyMs}ms</Text>}
        </Text>
      </Box>

      {breakdown.totalChars > 0 && (
        <>
          <Box height={1} marginTop={1}>
            <Text bold>Breakdown (estimated split)</Text>
          </Box>
          <Box height={1} marginLeft={2}>
            <Text color="gray">
              Conversation {pct(breakdown.conversationChars, breakdown.totalChars)}%  Tool calls{" "}
              {pct(breakdown.toolChars, breakdown.totalChars)}%  Other {pct(breakdown.otherChars, breakdown.totalChars)}%
            </Text>
          </Box>
          {breakdown.totalChars > 2000 && breakdown.toolChars / breakdown.totalChars > 0.4 && (
            <Box height={1} marginLeft={2}>
              <Text color="yellow">⚠ Tool-call output is over 40% of this conversation — try /reset to compact it.</Text>
            </Box>
          )}
        </>
      )}

      {memory.length > 0 && (
        <>
          <Box height={1} marginTop={1}>
            <Text bold>Working Memory</Text>
          </Box>
          {memory.slice(0, rows - 8).map((item, i) => (
            <Box key={i} height={1} marginLeft={2}>
              <Text>
                <Text color="cyan">{item.kind}</Text>
                <Text color="gray"> {item.key}: </Text>
                <Text wrap="truncate">{item.value.slice(0, width - 20)}</Text>
              </Text>
            </Box>
          ))}
        </>
      )}

      {execution.steps.length > 0 && (
        <>
          <Box height={1} marginTop={1}>
            <Text bold>Execution Plan ({execution.steps.length} steps)</Text>
          </Box>
          <Box marginLeft={2}>
            <Text color="gray" wrap="truncate">
              {execution.goal.slice(0, width - 10)}
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
}
