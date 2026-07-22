import React from "react";
import { Box, Text } from "ink";
import { ChatEntry, RuntimeState } from "../../runtime/types.js";
import { truncate } from "../../layout/truncate.js";

export interface ActivityFeedPanelProps {
  state: RuntimeState;
  width: number;
  rows: number;
}

type ActivityEntry = Extract<ChatEntry, { kind: "tool_call" | "diff_preview" | "plan" | "test_result" | "card" }>;

function isActivity(e: ChatEntry): e is ActivityEntry {
  return e.kind === "tool_call" || e.kind === "diff_preview" || e.kind === "plan" || e.kind === "test_result" || e.kind === "card";
}

function statusBadge(entry: ActivityEntry): { label: string; color: string } {
  switch (entry.kind) {
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
  if (entry.kind === "tool_call") return entry.crumb ?? entry.name;
  if (entry.kind === "diff_preview") return entry.crumb ?? entry.filePath;
  if (entry.kind === "test_result") return entry.crumb ?? "Test";
  if (entry.kind === "plan") return "Plan";
  return entry.crumb ?? entry.title;
}

function bodyLines(entry: ActivityEntry, width: number): string[] {
  switch (entry.kind) {
    case "tool_call": {
      const args = Object.values(entry.args)
        .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
        .join(", ");
      const lines = [truncate(args, width)];
      if (entry.error) lines.push(truncate(`Error: ${entry.error}`, width));
      else if (entry.result) lines.push(truncate(entry.result, width));
      return lines;
    }
    case "diff_preview": {
      const additions = entry.diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
      const deletions = entry.diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
      return [truncate(`${entry.filePath}  +${additions} -${deletions}`, width)];
    }
    case "test_result":
      return [truncate(`${entry.command}  ${entry.passed} passed, ${entry.failed} failed`, width)];
    case "plan":
      return [truncate(`${entry.steps.length} steps`, width)];
    case "card":
      return [truncate(`${entry.items.length} items`, width)];
  }
}

function formatTime(at: number): string {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * Center-column Activity Feed: a real execution log — timestamp, mission
 * breadcrumb, right-aligned status, newest entry first. Deliberately only
 * the execution-activity ChatEntry kinds (tool_call/diff_preview/plan/
 * test_result/card) — plain chat text stays in the Conversation view.
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

  const visible: Array<{ entry: ActivityEntry; lines: string[] }> = [];
  let used = 0;
  for (const entry of entries) {
    const lines = bodyLines(entry, Math.max(4, width - 2));
    const height = 1 + lines.length + 1; // header + body + blank separator row
    if (used + height > rows && visible.length > 0) break;
    visible.push({ entry, lines });
    used += height;
    if (used >= rows) break;
  }

  return (
    <Box flexDirection="column" width={width} height={rows}>
      {visible.map(({ entry, lines }, i) => {
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
            {lines.map((line, li) => (
              <Box key={li} height={1} paddingLeft={2}>
                <Text color="gray" wrap="truncate">
                  {line}
                </Text>
              </Box>
            ))}
            <Box height={1} />
          </Box>
        );
      })}
    </Box>
  );
}
