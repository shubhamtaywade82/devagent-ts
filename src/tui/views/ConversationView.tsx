import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { ChatEntry, ExecutionStep, RuntimeState } from "../../runtime/types";
import { DetailLevel } from "../../layout/density";
import { tail } from "../../layout/truncate";
import { renderMarkdown, RichLine, Span } from "../markdown";
import { PlanCard } from "../components/PlanCard";
import { DecisionCard } from "../components/DecisionCard";
import { ToolCallCard } from "../components/ToolCallCard";
import { DiffPreview } from "../components/DiffPreview";
import { TestResultCard } from "../components/TestResultCard";
import { StatusCard } from "../components/StatusCard";

export interface ViewProps {
  state: RuntimeState;
  width: number;
  rows: number;
  detail: DetailLevel;
}

const ROLE_STYLE: Record<string, { label: string; color: string }> = {
  user: { label: "You", color: "green" },
  assistant: { label: "Agy", color: "blue" },
  thinking: { label: "Thinking", color: "magenta" },
  tool: { label: "Tool", color: "yellow" },
  system: { label: "System", color: "gray" },
};

function RichText({ spans, role }: { spans: Span[]; role: string }): JSX.Element {
  return (
    <Text wrap="truncate" color={role === "thinking" ? "gray" : undefined}>
      {spans.map((s, j) => {
        if (s.code) {
          return <Text key={j} inverse>{` ${s.text} `}</Text>;
        }
        return (
          <Text key={j} bold={s.bold} italic={s.italic}>
            {s.text}
          </Text>
        );
      })}
    </Text>
  );
}

function textEntryLines(entry: ChatEntry, bodyWidth: number, detail: DetailLevel): RichLine[] {
  if (entry.kind !== "text") return [];
  const body = detail === "compact" && entry.role === "thinking" ? "" : entry.text;
  if (!body) return [];
  return renderMarkdown(body, entry.role, bodyWidth);
}

function structuredEntryLineCount(entry: ChatEntry, collapsed: boolean): number {
  if (entry.kind === "text") return 0;
  if (collapsed) return 1;
  switch (entry.kind) {
    case "plan":
      return 1 + entry.steps.length;
    case "decision":
      return 3 + (entry.reason ? 1 : 0);
    case "tool_call":
      return 1 + (entry.error ? 1 : 0) + (entry.result ? 1 : 0);
    case "diff_preview":
      return 1 + Math.min(entry.diff.split("\n").filter(Boolean).length, 31);
    case "test_result":
      return 3 + entry.failures.length * 2;
    case "card":
      return 1 + entry.items.length;
    default:
      return 1;
  }
}

function StructuredEntry({
  entry,
  collapsed,
  onToggle,
  width,
}: {
  entry: ChatEntry;
  collapsed: boolean;
  onToggle: () => void;
  width: number;
}): JSX.Element | null {
  if (entry.kind === "plan") return <PlanCard entry={entry} collapsed={collapsed} onToggle={onToggle} width={width} />;
  if (entry.kind === "decision") return <DecisionCard entry={entry} collapsed={collapsed} onToggle={onToggle} width={width} />;
  if (entry.kind === "tool_call") return <ToolCallCard entry={entry} collapsed={collapsed} onToggle={onToggle} width={width} />;
  if (entry.kind === "diff_preview") return <DiffPreview entry={entry} collapsed={collapsed} onToggle={onToggle} width={width} />;
  if (entry.kind === "test_result") return <TestResultCard entry={entry} collapsed={collapsed} onToggle={onToggle} width={width} />;
  if (entry.kind === "card") return <StatusCard entry={entry} collapsed={collapsed} onToggle={onToggle} width={width} />;
  return null;
}

export function ConversationView({ state, width, rows, detail }: ViewProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [scrollOffset, setScrollOffset] = useState(0);
  const maxLabelLength = Math.max(...Object.values(ROLE_STYLE).map((s) => s.label.length));
  const gutter = detail === "compact" ? 0 : maxLabelLength + 3;
  const bodyWidth = Math.max(10, width - gutter);

  const toggleEntry = useCallback((at: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(at)) next.delete(at);
      else next.add(at);
      return next;
    });
  }, []);

  // Build flat line array: text entries produce RichLines,
  // structured entries produce synthetic lines for scroll tracking.
  const lines: RichLine[] = [];
  const entryBreak: number[] = []; // line index where each non-text entry starts
  for (const entry of state.conversation) {
    if (entry.kind === "text") {
      const entryLines = textEntryLines(entry, bodyWidth, detail);
      for (const rl of entryLines) {
        if (lines.length === 0) rl.first = true;
        lines.push(rl);
      }
    } else {
      entryBreak.push(lines.length);
      // Add a single "role label" line for the structured entry header
      const style = ROLE_STYLE[entry.role] ?? { label: "?", color: "gray" };
      lines.push({
        role: entry.role,
        spans: [{ text: `${style.label} ▸ `, bold: true }],
        first: true,
      });
      // Add extra lines for the structured entry's visual space
      // (we'll render the actual component inline below)
      const extra = structuredEntryLineCount(entry, collapsed.has(entry.at));
      for (let i = 1; i < extra; i++) {
        lines.push({ role: entry.role, spans: [{ text: "" }], first: false });
      }
    }
  }

  const maxOffset = Math.max(0, lines.length - rows);
  const clampedOffset = Math.min(scrollOffset, maxOffset);
  const visible =
    clampedOffset === 0
      ? tail(lines, rows)
      : lines.slice(lines.length - rows - clampedOffset, lines.length - clampedOffset);

  useInput((_input, key) => {
    if (key.pageUp) {
      setScrollOffset((prev) => Math.min(maxOffset, prev + rows));
    } else if (key.pageDown) {
      setScrollOffset((prev) => Math.max(0, prev - rows));
    }
  });

  const maxOffsetRef = useRef(maxOffset);
  maxOffsetRef.current = maxOffset;

  useEffect(() => {
    if (!process.stdin.isTTY) return;
    const handler = (data: Buffer) => {
      const str = data.toString();
      // eslint-disable-next-line no-control-regex -- matching an SGR mouse-tracking escape sequence
      const match = str.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/);
      if (!match) return;
      const btn = parseInt(match[1], 10);
      if (btn === 64) {
        setScrollOffset((prev) => Math.min(maxOffsetRef.current, prev + 3));
      } else if (btn === 65) {
        setScrollOffset((prev) => Math.max(0, prev - 3));
      }
    };
    process.stdin.on("data", handler);
    return () => {
      process.stdin.off("data", handler);
    };
  }, []);

  // Determine which structured entries are visible
  const visibleStartLine = clampedOffset === 0
    ? Math.max(0, lines.length - rows)
    : lines.length - rows - clampedOffset;
  const visibleEndLine = visibleStartLine + rows;

  const visibleStructured: { entry: ChatEntry; lineIndex: number }[] = [];
  for (let i = 0; i < state.conversation.length; i++) {
    const entry = state.conversation[i];
    if (entry.kind === "text") continue;
    const lineIdx = entryBreak[visibleStructured.length];
    if (lineIdx >= visibleStartLine && lineIdx < visibleEndLine) {
      visibleStructured.push({ entry, lineIndex: lineIdx });
    }
  }

  // Reconstruct the rendering by replacing structured entry placeholder lines
  // We render line-by-line, but for structured entries we render the component
  // at the correct position.
  const renderLines: { type: "rich"; line: RichLine }[] = [];
  let structIdx = 0;
  for (const line of visible) {
    // Check if this line position matches a structured entry header
    const svIdx = visibleStructured.findIndex(
      (sv) => sv.lineIndex >= visibleStartLine && sv.lineIndex < visibleStartLine + visible.length,
    );
    // Simpler approach: iterate through visible lines and replace
    renderLines.push({ type: "rich", line });
  }

  return (
    <Box flexDirection="column" height={rows}>
      {visible.length === 0 ? (
        <Text color="gray">No conversation yet — type below to begin.</Text>
      ) : (
        <Box flexDirection="column" height={rows}>
          {visible.map((line, i) => {
            // Check if a structured entry starts at this line's absolute position
            const absLine = visibleStartLine + i;
            const structEntry = state.conversation.find((entry, ci) => {
              if (entry.kind === "text") return false;
              const breakIdx = entryBreak[state.conversation.slice(0, ci + 1).filter(e => e.kind !== "text").length - 1];
              return breakIdx === absLine;
            });
            if (structEntry && structEntry.kind !== "text") {
              return (
                <Box key={`struct-${structEntry.at}`} height={structuredEntryLineCount(structEntry, collapsed.has(structEntry.at))}>
                  <StructuredEntry
                    entry={structEntry}
                    collapsed={collapsed.has(structEntry.at)}
                    onToggle={() => toggleEntry(structEntry.at)}
                    width={bodyWidth}
                  />
                </Box>
              );
            }
            const style = ROLE_STYLE[line.role] ?? { label: "?", color: "gray" };
            return (
              <Box key={i} height={1}>
                {gutter > 0 && (
                  <Box width={gutter}>
                    <Text color={style.color} dimColor={!line.first}>
                      {line.first ? `${style.label} ▸ ` : ""}
                    </Text>
                  </Box>
                )}
                {line.indent ? <Box width={line.indent} /> : null}
                <RichText spans={line.spans} role={line.role} />
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
