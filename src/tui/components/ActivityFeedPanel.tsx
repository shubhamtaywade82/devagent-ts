import React from "react";
import { Box, Text } from "ink";
import { ChatEntry, RuntimeState } from "../../runtime/types.js";
import { truncate } from "../../layout/truncate.js";
import { renderSimpleMarkdown } from "../markdown.js";
import { SpanText } from "./SpanText.js";
import { formatArgs } from "../views/ConversationView.js";

export interface ActivityFeedPanelProps {
  state: RuntimeState;
  width: number;
  rows: number;
}

type ActivityEntry = Extract<ChatEntry, { kind: "tool_call" | "diff_preview" | "plan" | "test_result" | "card" }> | ChatText;

// user/assistant only — thinking/system text is internal noise, not activity.
type ChatText = Extract<ChatEntry, { kind: "text" }> & { role: "user" | "assistant" };

function isActivity(e: ChatEntry): e is ActivityEntry {
  if (e.kind === "text") return e.role === "user" || e.role === "assistant";
  return e.kind === "tool_call" || e.kind === "diff_preview" || e.kind === "plan" || e.kind === "test_result" || e.kind === "card";
}

function statusBadge(entry: ActivityEntry): { label: string; color: string } {
  switch (entry.kind) {
    case "text":
      return entry.role === "user" ? { label: "You", color: "cyan" } : { label: "Reply", color: "green" };
    case "tool_call":
      return entry.status === "running"
        ? { label: "Running", color: "blue" }
        : entry.status === "failed"
          ? { label: "Failed", color: "red" }
          : { label: "Completed", color: "green" };
    case "diff_preview":
      return entry.status === "pending_review"
        ? { label: "Pending", color: "yellow" }
        : entry.status === "rejected"
          ? { label: "Rejected", color: "red" }
          : { label: "Approved", color: "green" };
    case "test_result":
      return entry.failed > 0 ? { label: "Failed", color: "red" } : { label: "Passed", color: "green" };
    case "plan":
    case "card":
      return entry.status === "running"
        ? { label: "Running", color: "blue" }
        : entry.status === "failed"
          ? { label: "Failed", color: "red" }
          : { label: "Completed", color: "green" };
  }
}

function breadcrumb(entry: ActivityEntry): string {
  if (entry.kind === "text") return entry.role === "user" ? "You" : "Assistant";
  if (entry.kind === "tool_call") return entry.crumb ?? entry.name;
  if (entry.kind === "diff_preview") return entry.crumb ?? entry.filePath;
  if (entry.kind === "test_result") return entry.crumb ?? "Test";
  if (entry.kind === "plan") return "Plan";
  return entry.crumb ?? entry.title;
}

const STEP_GLYPHS: Record<string, { char: string; color: string }> = {
  completed: { char: "✓", color: "green" },
  failed: { char: "✗", color: "red" },
  running: { char: "▶", color: "yellow" },
  pending: { char: "○", color: "gray" },
  skipped: { char: "–", color: "gray" },
};

/**
 * Body renderer per entry kind — matches ConversationView's own formatting
 * (same colors/glyphs/emoji) rather than a bespoke flattened summary, so an
 * entry looks the same whether you're in the Conversation view or the
 * Dashboard's Activity Feed. Returns both a line count (for the panel's
 * row budget) and the render function, since the two must stay in sync.
 */
function entryBody(entry: ActivityEntry, width: number): { lineCount: number; render: () => React.JSX.Element } {
  switch (entry.kind) {
    case "text": {
      // Unlike every other kind below (diff caps at 4 changes, plan at 8
      // steps, card at 6 items), a chat reply has no natural cap — a long
      // resumed-session message can wrap to dozens of lines. Ink doesn't
      // clip a Box's overflowing children to its declared height, so an
      // uncapped entry here doesn't just get cut off, it bleeds into
      // whatever the sibling columns render at those same row indices —
      // corrupting the entire Dashboard layout, not just this panel.
      const allLines = renderSimpleMarkdown(entry.text, Math.max(4, width - 2));
      const MAX_TEXT_LINES = 6;
      const lines = allLines.slice(0, MAX_TEXT_LINES);
      const hasMore = allLines.length > MAX_TEXT_LINES;
      const showTag = entry.role === "assistant" && !!entry.model;
      return {
        lineCount: lines.length + (hasMore ? 1 : 0) + (showTag ? 1 : 0),
        render: () => (
          <Box flexDirection="column">
            {lines.map((line, li) => (
              <Box key={li} height={1}>
                {li === 0 ? (
                  <Text color={entry.role === "user" ? "green" : "cyan"}>{entry.role === "user" ? "> " : "• "}</Text>
                ) : (
                  <Box width={2} />
                )}
                {line.indent ? <Box width={line.indent} /> : null}
                <SpanText spans={line.spans} />
              </Box>
            ))}
            {hasMore && (
              <Box height={1}>
                <Box width={2} />
                <Text color="gray" dimColor>
                  ... {allLines.length - MAX_TEXT_LINES} more lines (see Conversation view)
                </Text>
              </Box>
            )}
            {showTag && (
              <Box height={1}>
                <Box width={2} />
                <Text color="gray" dimColor>
                  ↳ {entry.model}
                </Text>
              </Box>
            )}
          </Box>
        ),
      };
    }
    case "tool_call": {
      const args = formatArgs(entry.args);
      const lines: Array<{ text: string; color: string }> = [{ text: truncate(args, width), color: "gray" }];
      if (entry.error) lines.push({ text: truncate(`Error: ${entry.error}`, width), color: "red" });
      else if (entry.result) lines.push({ text: truncate(entry.result, width), color: "gray" });
      return {
        lineCount: lines.length,
        render: () => (
          <Box flexDirection="column">
            {lines.map((l, i) => (
              <Box key={i} height={1}>
                <Text color={l.color}>{l.text}</Text>
              </Box>
            ))}
          </Box>
        ),
      };
    }
    case "diff_preview": {
      const diffLines = entry.diff.split("\n");
      const changes: Array<{ text: string; color: string }> = [];
      let additions = 0;
      let deletions = 0;
      for (const line of diffLines) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          additions++;
          if (changes.length < 4) changes.push({ text: truncate(line, width - 2), color: "green" });
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          deletions++;
          if (changes.length < 4) changes.push({ text: truncate(line, width - 2), color: "red" });
        }
      }
      const hasMore =
        diffLines.filter((l) => (l.startsWith("+") && !l.startsWith("+++")) || (l.startsWith("-") && !l.startsWith("---"))).length >
        changes.length;
      return {
        lineCount: 1 + changes.length + (hasMore ? 1 : 0),
        render: () => (
          <Box flexDirection="column">
            <Box height={1}>
              <Text color="green">+{additions} </Text>
              <Text color="red">-{deletions}</Text>
            </Box>
            {changes.map((ch, i) => (
              <Box key={i} height={1} paddingLeft={2}>
                <Text color={ch.color}>{ch.text}</Text>
              </Box>
            ))}
            {hasMore && (
              <Box height={1} paddingLeft={2}>
                <Text color="gray">...</Text>
              </Box>
            )}
          </Box>
        ),
      };
    }
    case "plan": {
      const steps = entry.steps.slice(0, 8);
      return {
        lineCount: steps.length,
        render: () => (
          <Box flexDirection="column">
            {steps.map((step, i) => {
              const g = STEP_GLYPHS[step.status] ?? STEP_GLYPHS.pending;
              return (
                <Box key={step.id} height={1}>
                  <Text color="gray"> {i + 1}) </Text>
                  <Text color={g.color}>{g.char} </Text>
                  <Text color={step.status === "completed" ? "gray" : "white"} wrap="truncate">
                    {truncate(step.description, Math.max(4, width - 6))}
                  </Text>
                </Box>
              );
            })}
          </Box>
        ),
      };
    }
    case "test_result": {
      const isSuccess = entry.failed === 0;
      const statusColor = isSuccess ? "green" : "red";
      const durationSec = (entry.durationMs / 1000).toFixed(1);
      const failureLines: Array<{ text: string; color: string }> = [];
      if (!isSuccess) {
        for (const f of entry.failures.slice(0, 2)) {
          failureLines.push({ text: truncate(`✗ ${f.file}:${f.line}`, width - 2), color: "red" });
          failureLines.push({ text: truncate(`  ${f.message.replace(/\s+/g, " ")}`, width - 2), color: "gray" });
        }
        if (entry.failures.length > 2) {
          failureLines.push({ text: `... and ${entry.failures.length - 2} more failures`, color: "gray" });
        }
      }
      return {
        lineCount: 2 + failureLines.length,
        render: () => (
          <Box flexDirection="column">
            <Box height={1}>
              <Text color="gray">{entry.command} </Text>
              <Text color={statusColor}>
                ({durationSec}s)
              </Text>
            </Box>
            <Box height={1}>
              <Text color={statusColor}>
                {isSuccess ? "✓" : "✗"} {entry.passed} passed, {entry.failed} failed
              </Text>
            </Box>
            {failureLines.map((fl, i) => (
              <Box key={i} height={1}>
                <Text color={fl.color}>{fl.text}</Text>
              </Box>
            ))}
          </Box>
        ),
      };
    }
    case "card": {
      const items = entry.items.slice(0, 6);
      return {
        lineCount: items.length,
        render: () => (
          <Box flexDirection="column">
            {items.map((item, i) => {
              const g = STEP_GLYPHS[item.status] ?? STEP_GLYPHS.pending;
              return (
                <Box key={i} height={1}>
                  <Text color={g.color}>{g.char} </Text>
                  <Text wrap="truncate">{truncate(item.label, Math.max(4, width - 4))}</Text>
                  {item.detail && (
                    <Text color="gray" wrap="truncate">
                      {" "}
                      ({item.detail})
                    </Text>
                  )}
                </Box>
              );
            })}
          </Box>
        ),
      };
    }
  }
}

function formatTime(at: number): string {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * Center-column Activity Feed: a real execution log — timestamp, mission
 * breadcrumb, right-aligned status, newest entry first, entry bodies
 * rendered with the same formatting ConversationView uses per kind
 * (colored diffs, tool-call args/result, plan/test/card detail — see
 * entryBody above). Covers execution-activity ChatEntry kinds plus plain
 * user/assistant chat text — Dashboard no longer force-switches to the
 * Conversation view on submit (see App.tsx's submitPrompt), so a reply with
 * no tool use still needs to show up here. thinking/system text stays
 * excluded as internal noise.
 */
export function ActivityFeedPanel({ state, width, rows }: ActivityFeedPanelProps): React.JSX.Element {
  const entries = [...state.conversation].filter(isActivity).reverse();

  if (entries.length === 0) {
    return (
      <Box height={rows} width={width}>
        <Text color="gray" dimColor>
          No activity yet.
        </Text>
      </Box>
    );
  }

  const bodyWidth = Math.max(4, width - 2);
  const visible: Array<{ entry: ActivityEntry; body: ReturnType<typeof entryBody> }> = [];
  let used = 0;
  for (const entry of entries) {
    const body = entryBody(entry, bodyWidth);
    const height = 1 + body.lineCount + 1; // header + body + blank separator row
    if (used + height > rows && visible.length > 0) break;
    visible.push({ entry, body });
    used += height;
    if (used >= rows) break;
  }

  return (
    <Box flexDirection="column" width={width} height={rows}>
      {visible.map(({ entry, body }, i) => {
        const badge = statusBadge(entry);
        const time = formatTime(entry.at);
        const rightLabel = badge.label;
        const crumbWidth = Math.max(4, width - time.length - 1 - rightLabel.length - 1);
        const crumb = truncate(breadcrumb(entry), crumbWidth);
        const gap = Math.max(1, width - time.length - 1 - crumb.length - rightLabel.length);
        return (
          <Box key={i} flexDirection="column">
            <Box height={1}>
              <Text color="gray">{time} </Text>
              <Text bold color="white">
                {crumb}
              </Text>
              <Text>{" ".repeat(gap)}</Text>
              <Text color={badge.color}>{rightLabel}</Text>
            </Box>
            <Box paddingLeft={2} flexDirection="column">
              {body.render()}
            </Box>
            <Box height={1} />
          </Box>
        );
      })}
    </Box>
  );
}
