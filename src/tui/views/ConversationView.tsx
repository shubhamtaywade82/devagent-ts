import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { ChatEntry, RuntimeState } from "../../runtime/types";
import { DetailLevel } from "../../layout/density";
import { truncate } from "../../layout/truncate";
import { parseInline, Span } from "../markdown";

export interface ViewProps {
  state: RuntimeState;
  width: number;
  rows: number;
  detail: DetailLevel;
}

function formatArgs(args: Record<string, unknown>): string {
  return Object.values(args)
    .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
    .join(", ");
}

function SpanText({ spans }: { spans: Span[] }): JSX.Element {
  return (
    <Text wrap="truncate">
      {spans.map((s, j) => {
        if (s.code) return <Text key={j} inverse>{` ${s.text} `}</Text>;
        return (
          <Text key={j} bold={s.bold} italic={s.italic}>
            {s.text}
          </Text>
        );
      })}
    </Text>
  );
}

function wrapText(text: string, width: number): string[] {
  if (text.length <= width) return [text];
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    lines.push(remaining.slice(0, width));
    remaining = remaining.slice(width);
  }
  return lines;
}

function renderSimpleMarkdown(text: string, bodyWidth: number): { spans: Span[]; indent?: number }[] {
  const rawLines = text.split("\n");
  const result: { spans: Span[]; indent?: number }[] = [];
  let inCode = false;
  let codeLines: string[] = [];

  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("```")) {
      if (inCode) {
        for (const cl of codeLines) {
          result.push({ spans: [{ text: cl, code: true }], indent: 2 });
        }
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(raw);
      continue;
    }
    if (!raw.trim()) {
      result.push({ spans: [{ text: "" }] });
      continue;
    }

    if (raw.startsWith("#")) {
      const content = raw.replace(/^#+\s*/, "");
      for (const line of wrapText(content, bodyWidth)) {
        result.push({ spans: parseInline(line).map((s) => ({ ...s, bold: true })) });
      }
      continue;
    }
    if (raw.match(/^[-*]\s/)) {
      const content = raw.replace(/^[-*]\s/, "");
      for (const line of wrapText(content, bodyWidth - 2)) {
        result.push({ spans: [{ text: "• " }, ...parseInline(line)], indent: 2 });
      }
      continue;
    }
    if (raw.startsWith("> ")) {
      const content = raw.replace(/^>\s*/, "");
      for (const line of wrapText(content, bodyWidth - 2)) {
        result.push({ spans: parseInline(line).map((s) => ({ ...s, italic: true })), indent: 2 });
      }
      continue;
    }
    for (const line of wrapText(raw, bodyWidth)) {
      result.push({ spans: parseInline(line) });
    }
  }

  if (codeLines.length > 0) {
    for (const cl of codeLines) {
      result.push({ spans: [{ text: cl, code: true }], indent: 2 });
    }
  }
  return result;
}

function TurnSeparator({ width }: { width: number }): JSX.Element {
  return (
    <Box height={1}>
      <Text color="gray" dimColor wrap="truncate">
        {"─".repeat(Math.max(1, width))}
      </Text>
    </Box>
  );
}

function ToolCallBlock({
  entry,
  collapsed,
  width,
}: {
  entry: ChatEntry & { kind: "tool_call" };
  collapsed: boolean;
  width: number;
}): JSX.Element {
  const args = formatArgs(entry.args);
  const statusGlyph = entry.status === "running" ? "◌" : entry.status === "completed" ? "●" : "✗";
  return (
    <Box flexDirection="column">
      <Box height={1}>
        <Text color="yellow">{statusGlyph} </Text>
        <Text bold>{entry.name}</Text>
        <Text color="gray" wrap="truncate">
          ({truncate(args, Math.max(10, width - 6 - entry.name.length))})
        </Text>
      </Box>
      {!collapsed && (entry.result || entry.error) && (
        <Box marginLeft={3} flexDirection="column">
          {entry.error && (
            <Box height={1}>
              <Text color="red" wrap="truncate">
                Error: {truncate(entry.error, width - 10)}
              </Text>
            </Box>
          )}
          {entry.result && (
            <Box>
              <Text color="gray" wrap="truncate">
                {truncate(entry.result, width - 5)}
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

interface RenderedBlock {
  key: string;
  height: number;
  render: () => JSX.Element;
}

export function ConversationView({ state, width, rows, detail: _detail }: ViewProps): JSX.Element {
  const [collapsed] = useState<Set<number>>(new Set());
  const bodyWidth = Math.max(10, width);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Build renderable blocks from conversation entries
  const blocks = useMemo<RenderedBlock[]>(() => {
    const b: RenderedBlock[] = [];
    let prevRole: string | null = null;

    for (const entry of state.conversation) {
      const currentRole = entry.role;
      if (prevRole !== null && prevRole !== currentRole) {
        if (currentRole === "user") {
          b.push({
            key: `sep-${entry.at}`,
            height: 1,
            render: () => <TurnSeparator key={`sep-${entry.at}`} width={bodyWidth} />,
          });
        } else {
          b.push({
            key: `space-${entry.at}`,
            height: 1,
            render: () => <Box key={`space-${entry.at}`} height={1} />,
          });
        }
      }
      prevRole = currentRole;

      if (entry.kind === "text") {
        if (entry.role === "thinking") {
          const preview = entry.text.slice(0, bodyWidth - 6).replace(/\n.*$/s, "") || "Thinking...";
          b.push({
            key: `think-${entry.at}`,
            height: 1,
            render: () => (
              <Box key={`think-${entry.at}`} flexDirection="column">
                <Box height={1}>
                  <Text color="magenta" dimColor wrap="truncate">
                    ▸ {preview}
                  </Text>
                </Box>
              </Box>
            ),
          });
        } else if (entry.role === "user") {
          const lines = renderSimpleMarkdown(entry.text, bodyWidth - 2);
          b.push({
            key: `user-${entry.at}`,
            height: lines.length,
            render: () => (
              <Box key={`user-${entry.at}`} flexDirection="column">
                {lines.map((line, li) => (
                  <Box key={li} height={1}>
                    {li === 0 ? <Text color="green">&gt; </Text> : <Box width={2} />}
                    {line.indent ? <Box width={line.indent} /> : null}
                    <SpanText spans={line.spans} />
                  </Box>
                ))}
              </Box>
            ),
          });
        } else {
          // assistant
          const lines = renderSimpleMarkdown(entry.text, bodyWidth - 2);
          b.push({
            key: `asst-${entry.at}`,
            height: lines.length,
            render: () => (
              <Box key={`asst-${entry.at}`} flexDirection="column">
                {lines.map((line, li) => (
                  <Box key={li} height={1}>
                    <Box width={2} />
                    {line.indent ? <Box width={line.indent} /> : null}
                    <SpanText spans={line.spans} />
                  </Box>
                ))}
              </Box>
            ),
          });
        }
      } else if (entry.kind === "tool_call") {
        const isCollapsed = collapsed.has(entry.at);
        const extraHeight = isCollapsed ? 0 : (entry.result ? 1 : 0) + (entry.error ? 1 : 0);
        b.push({
          key: `tool-${entry.at}`,
          height: 1 + extraHeight,
          render: () => <ToolCallBlock entry={entry} collapsed={isCollapsed} width={bodyWidth} />,
        });
      } else if (entry.kind === "plan") {
        b.push({
          key: `plan-${entry.at}`,
          height: 1,
          render: () => (
            <Box key={`plan-${entry.at}`} height={1}>
              <Text color="blue">
                📋 Plan ({entry.steps.length} steps): {entry.status}
              </Text>
            </Box>
          ),
        });
      } else if (entry.kind === "decision") {
        b.push({
          key: `decision-${entry.at}`,
          height: 1,
          render: () => (
            <Box key={`decision-${entry.at}`} height={1}>
              <Text color="cyan">✓ {entry.selected}</Text>
            </Box>
          ),
        });
      } else if (entry.kind === "diff_preview") {
        b.push({
          key: `diff-${entry.at}`,
          height: 1,
          render: () => (
            <Box key={`diff-${entry.at}`} height={1}>
              <Text color="yellow">
                📄 {entry.filePath} ({entry.status})
              </Text>
            </Box>
          ),
        });
      } else if (entry.kind === "test_result") {
        b.push({
          key: `test-${entry.at}`,
          height: 1,
          render: () => (
            <Box key={`test-${entry.at}`} height={1}>
              <Text color={entry.failed > 0 ? "red" : "green"}>
                {entry.failed > 0 ? "✗" : "✓"} Tests: {entry.passed} passed, {entry.failed} failed
              </Text>
            </Box>
          ),
        });
      } else if (entry.kind === "card") {
        b.push({
          key: `card-${entry.at}`,
          height: 1,
          render: () => (
            <Box key={`card-${entry.at}`} height={1}>
              <Text color="gray">
                [{entry.status}] {entry.title}
              </Text>
            </Box>
          ),
        });
      }
    }
    return b;
  }, [state.conversation, collapsed, bodyWidth]);

  const totalHeight = blocks.reduce((s, b) => s + b.height, 0);
  const maxOffset = Math.max(0, totalHeight - rows);
  const clampedOffset = Math.min(scrollOffset, maxOffset);

  // Blocks visible at this scroll position: we show the last `rows` rows.
  const visibleEnd = totalHeight - clampedOffset;
  const visibleStart = Math.max(0, visibleEnd - rows);

  // Find the first block that overlaps the visible window
  let blockStart = 0;
  let firstVisibleIdx = 0;
  for (let i = 0; i < blocks.length; i++) {
    const blockEnd = blockStart + blocks[i].height;
    if (blockEnd > visibleStart) {
      firstVisibleIdx = i;
      break;
    }
    blockStart = blockEnd;
  }

  // Limit to only blocks within visible window
  const visibleBlocks: RenderedBlock[] = [];
  let currentRow = blockStart;
  for (let i = firstVisibleIdx; i < blocks.length && currentRow < visibleEnd; i++) {
    const b = blocks[i];
    if (currentRow + b.height > visibleStart) {
      visibleBlocks.push(b);
    }
    currentRow += b.height;
  }

  useInput((_input, key) => {
    if (key.pageUp) setScrollOffset((prev) => Math.min(maxOffset, prev + rows));
    else if (key.pageDown) setScrollOffset((prev) => Math.max(0, prev - rows));
  });

  const maxOffsetRef = useRef(maxOffset);
  maxOffsetRef.current = maxOffset;

  useEffect(() => {
    if (!process.stdin.isTTY) return;
    const handler = (data: Buffer) => {
      const m = data.toString().match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/);
      if (!m) return;
      const btn = parseInt(m[1], 10);
      if (btn === 64) setScrollOffset((prev) => Math.min(maxOffsetRef.current, prev + 3));
      else if (btn === 65) setScrollOffset((prev) => Math.max(0, prev - 3));
    };
    process.stdin.on("data", handler);
    return () => {
      process.stdin.off("data", handler);
    };
  }, []);

  if (blocks.length === 0) {
    return (
      <Box height={rows}>
        <Text color="gray">No conversation yet — type below to begin.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={rows}>
      {visibleBlocks.map((b) => b.render())}
    </Box>
  );
}
