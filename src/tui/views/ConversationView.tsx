import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { ChatEntry, RuntimeState } from "../../runtime/types.js";
import { DetailLevel } from "../../layout/density.js";
import { truncate } from "../../layout/truncate.js";
import { renderSimpleMarkdown } from "../markdown.js";
import { SpanText } from "../components/SpanText.js";

export interface ViewProps {
  state: RuntimeState;
  width: number;
  rows: number;
  detail: DetailLevel;
  /** App's render clock — lets panels tick elapsed times with the app instead of Date.now() at render. */
  now?: number;
}

export function formatArgs(args: Record<string, unknown>): string {
  return Object.values(args)
    .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
    .join(", ");
}

function countDiff(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions };
}

export interface GroupSummary {
  files: Array<{ path: string; additions: number; deletions: number }>;
  totalAdditions: number;
  totalDeletions: number;
  test?: { passed: number; failed: number };
}

/** Aggregate a phase group's entries into a compact summary, or null when
 * the group has nothing worth summarizing (pure tool-call groups — the
 * tool tree is already compact). */
export function summarizeGroup(entries: ChatEntry[]): GroupSummary | null {
  const byPath = new Map<string, { additions: number; deletions: number }>();
  let test: GroupSummary["test"];
  for (const e of entries) {
    if (e.kind === "diff_preview") {
      const { additions, deletions } = countDiff(e.diff);
      const prev = byPath.get(e.filePath) ?? { additions: 0, deletions: 0 };
      byPath.set(e.filePath, { additions: prev.additions + additions, deletions: prev.deletions + deletions });
    } else if (e.kind === "test_result") {
      test = { passed: e.passed, failed: e.failed };
    }
  }
  if (byPath.size === 0 && !test) return null;
  const files = [...byPath.entries()].map(([path, c]) => ({ path, ...c }));
  return {
    files,
    totalAdditions: files.reduce((s, f) => s + f.additions, 0),
    totalDeletions: files.reduce((s, f) => s + f.deletions, 0),
    test,
  };
}

function TurnSeparator({ width }: { width: number }): React.JSX.Element {
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
  isLast,
}: {
  entry: ChatEntry & { kind: "tool_call" };
  collapsed: boolean;
  width: number;
  isLast: boolean;
}): React.JSX.Element {
  const args = formatArgs(entry.args);
  const isRunning = entry.status === "running";
  const isFailed = entry.status === "failed";
  const statusColor = isRunning ? "yellow" : isFailed ? "red" : "green";
  const statusLabel = isRunning ? "running" : isFailed ? "failed" : "done";
  const connector = isLast ? "  └─ " : "  ├─ ";

  return (
    <Box flexDirection="column">
      <Box height={1}>
        <Text color="gray">{connector}</Text>
        <Text bold color="cyan">
          {entry.name}{" "}
        </Text>
        <Text color="gray" wrap="truncate">
          {truncate(args, Math.max(10, width - 20 - entry.name.length))}
        </Text>
        <Text color={statusColor} dimColor={!isRunning}>
          {" "}
          [{statusLabel}]
        </Text>
      </Box>
      {!collapsed && (entry.result || entry.error) && (
        <Box marginLeft={5} flexDirection="column">
          {entry.error && (
            <Box height={1}>
              <Text color="red" wrap="truncate">
                Error: {truncate(entry.error.replace(/\n/g, " "), width - 10)}
              </Text>
            </Box>
          )}
          {entry.result && (
            <Box height={1}>
              <Text color="gray" wrap="truncate">
                Result: {truncate(entry.result.replace(/\n/g, " "), width - 10)}
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
  render: (startRow: number, endRow: number) => React.JSX.Element;
}

export function ConversationView({ state, width, rows, detail: _detail }: ViewProps): React.JSX.Element {
  const [collapsed] = useState<Set<number>>(new Set());
  const bodyWidth = Math.max(10, width);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Build renderable blocks from conversation entries
  const blocks = useMemo<RenderedBlock[]>(() => {
    const b: RenderedBlock[] = [];
    let isFirst = true;
    let lastSpeaker: "user" | "assistant" | null = null;
    let prevCrumb: string | undefined;
    let group: ChatEntry[] = [];

    const flushGroup = (flushKey: string) => {
      const summary = summarizeGroup(group);
      group = [];
      if (!summary) return;
      const shown = summary.files.slice(0, 4);
      const overflow = summary.files.length - shown.length;
      const rows: Array<{ text: string; color: string }> = shown.map((f) => ({
        text: `  ✓ ${f.path}  +${f.additions} −${f.deletions}`,
        color: "green",
      }));
      if (overflow > 0) rows.push({ text: `  … and ${overflow} more files`, color: "gray" });
      if (summary.files.length > 0) {
        rows.push({
          text: `  ${summary.files.length} file${summary.files.length === 1 ? "" : "s"} · +${summary.totalAdditions} −${summary.totalDeletions}`,
          color: "gray",
        });
      }
      if (summary.test) {
        rows.push(
          summary.test.failed > 0
            ? { text: `  ✗ ${summary.test.failed} failed`, color: "red" }
            : { text: `  ✓ ${summary.test.passed} passed`, color: "green" },
        );
      }
      b.push({
        key: `sum-${flushKey}`,
        height: rows.length,
        render: (startRow, endRow) => (
          <Box key={`sum-${flushKey}`} flexDirection="column">
            {rows.slice(startRow, endRow).map((r, i) => (
              <Box key={i} height={1}>
                <Text color={r.color} wrap="truncate">
                  {r.text}
                </Text>
              </Box>
            ))}
          </Box>
        ),
      });
    };

    for (let idx = 0; idx < state.conversation.length; idx++) {
      const entry = state.conversation[idx];
      const crumb = "crumb" in entry ? entry.crumb : undefined;
      if (crumb !== prevCrumb) {
        flushGroup(`${idx}`);
        if (crumb) {
          b.push({
            key: `crumb-${idx}-${entry.at}`,
            height: 1,
            render: () => (
              <Box key={`crumb-${idx}-${entry.at}`} height={1}>
                <Text bold color="cyan" wrap="truncate">
                  ◆ {crumb}
                </Text>
              </Box>
            ),
          });
        }
        prevCrumb = crumb;
      }
      if (crumb) group.push(entry);
      // A tool call following the thought that spawned it (or another tool
      // call) reads as one unit — no blank row inside the chain.
      const prev = state.conversation[idx - 1];
      const chained =
        entry.kind === "tool_call" &&
        prev != null &&
        (prev.kind === "tool_call" || (prev.kind === "text" && prev.role === "thinking"));
      if (!isFirst) {
        if (entry.role === "user") {
          b.push({
            key: `sep-${entry.at}`,
            height: 1,
            render: () => <TurnSeparator key={`sep-${entry.at}`} width={bodyWidth} />,
          });
        } else if (!chained) {
          b.push({
            key: `space-${entry.at}`,
            height: 1,
            render: () => <Box key={`space-${entry.at}`} height={1} />,
          });
        }
      }
      isFirst = false;

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
          const showSpeaker = lastSpeaker !== "user";
          lastSpeaker = "user";
          b.push({
            key: `user-${entry.at}`,
            height: lines.length + (showSpeaker ? 1 : 0),
            render: (startRow, endRow) => {
              const speakerVisible = showSpeaker && startRow === 0;
              const bodyStart = showSpeaker ? Math.max(0, startRow - 1) : startRow;
              const bodyEnd = showSpeaker ? endRow - 1 : endRow;
              const visibleLines = lines.slice(bodyStart, bodyEnd);
              return (
                <Box key={`user-${entry.at}`} flexDirection="column">
                  {speakerVisible ? (
                    <Box height={1}>
                      <Text bold color="green">
                        You
                      </Text>
                    </Box>
                  ) : null}
                  {visibleLines.map((line, li) => (
                    <Box key={bodyStart + li} height={1}>
                      <Box width={2} />
                      {line.indent ? <Box width={line.indent} /> : null}
                      <SpanText spans={line.spans} />
                    </Box>
                  ))}
                </Box>
              );
            },
          });
        } else {
          // assistant
          const lines = renderSimpleMarkdown(entry.text, bodyWidth - 2);
          const showSpeaker = lastSpeaker !== "assistant";
          lastSpeaker = "assistant";
          b.push({
            key: `asst-${entry.at}`,
            height: lines.length + (showSpeaker ? 1 : 0),
            render: (startRow, endRow) => {
              const speakerVisible = showSpeaker && startRow === 0;
              const bodyStart = showSpeaker ? Math.max(0, startRow - 1) : startRow;
              const bodyEnd = showSpeaker ? endRow - 1 : endRow;
              const visibleLines = lines.slice(bodyStart, bodyEnd);
              return (
                <Box key={`asst-${entry.at}`} flexDirection="column">
                  {speakerVisible ? (
                    <Box height={1}>
                      <Text bold color="cyan">
                        DevAgent
                      </Text>
                      {entry.model ? (
                        <Text color="gray" dimColor>
                          {" "}
                          · {entry.model}
                        </Text>
                      ) : null}
                    </Box>
                  ) : null}
                  {visibleLines.map((line, li) => (
                    <Box key={bodyStart + li} height={1}>
                      <Box width={2} />
                      {line.indent ? <Box width={line.indent} /> : null}
                      <SpanText spans={line.spans} />
                    </Box>
                  ))}
                </Box>
              );
            },
          });
        }
      } else if (entry.kind === "tool_call") {
        const isCollapsed = collapsed.has(entry.at);
        const extraHeight = isCollapsed ? 0 : (entry.result ? 1 : 0) + (entry.error ? 1 : 0);
        const isLast = state.conversation[idx + 1]?.kind !== "tool_call";
        b.push({
          key: `tool-${entry.at}`,
          height: 1 + extraHeight,
          render: () => <ToolCallBlock entry={entry} collapsed={isCollapsed} width={bodyWidth} isLast={isLast} />,
        });
      } else if (entry.kind === "plan") {
        const headerText = `📋 Plan (${entry.steps.length} steps) [${entry.status}]`;
        const stepGlyphs = {
          completed: { char: "✓", color: "green" },
          failed: { char: "✗", color: "red" },
          running: { char: "▶", color: "yellow" },
          pending: { char: "○", color: "gray" },
          skipped: { char: "–", color: "gray" },
        };
        b.push({
          key: `plan-${entry.at}`,
          height: 1 + entry.steps.length,
          render: () => (
            <Box key={`plan-${entry.at}`} flexDirection="column">
              <Box height={1}>
                <Text bold color="blue">
                  {headerText}
                </Text>
              </Box>
              {entry.steps.map((step, idx) => {
                const s = stepGlyphs[step.status] || stepGlyphs.pending;
                return (
                  <Box key={step.id} height={1}>
                    <Text color="gray"> {idx + 1}) </Text>
                    <Text color={s.color}>{s.char} </Text>
                    <Text color={step.status === "completed" ? "gray" : "white"}>{step.description}</Text>
                  </Box>
                );
              })}
            </Box>
          ),
        });
      } else if (entry.kind === "decision") {
        const optionList = entry.options.join(", ");
        b.push({
          key: `decision-${entry.at}`,
          height: 3,
          render: () => (
            <Box key={`decision-${entry.at}`} flexDirection="column">
              <Box height={1}>
                <Text bold color="cyan">
                  🧠 Strategy Selection
                </Text>
                <Text color="gray"> (Options: {optionList})</Text>
              </Box>
              <Box height={1} marginLeft={2}>
                <Text>
                  <Text color="gray">Selected: </Text>
                  <Text bold color="green">
                    {entry.selected}
                  </Text>
                  <Text color="gray"> (Confidence: {Math.round(entry.confidence * 100)}%)</Text>
                </Text>
              </Box>
              <Box height={1} marginLeft={2}>
                <Text color="gray" wrap="truncate">
                  Reason: {truncate(entry.reason, width - 12)}
                </Text>
              </Box>
            </Box>
          ),
        });
      } else if (entry.kind === "diff_preview") {
        const diffLines = entry.diff.split("\n");
        const changes: Array<{ text: string; color: string }> = [];
        let additions = 0;
        let deletions = 0;
        for (const line of diffLines) {
          if (line.startsWith("+") && !line.startsWith("+++")) {
            additions++;
            if (changes.length < 4) {
              changes.push({ text: line, color: "green" });
            }
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            deletions++;
            if (changes.length < 4) {
              changes.push({ text: line, color: "red" });
            }
          }
        }
        const hasMore =
          diffLines.filter(
            (l) => (l.startsWith("+") && !l.startsWith("+++")) || (l.startsWith("-") && !l.startsWith("---")),
          ).length > changes.length;

        b.push({
          key: `diff-${entry.at}`,
          height: 1 + changes.length + (hasMore ? 1 : 0),
          render: () => (
            <Box key={`diff-${entry.at}`} flexDirection="column">
              <Box height={1}>
                <Text bold color="yellow">
                  📄 {entry.filePath}
                </Text>
                <Text color="gray"> ({entry.status}) </Text>
                <Text color="green">+{additions} </Text>
                <Text color="red">-{deletions}</Text>
              </Box>
              {changes.map((ch, idx) => (
                <Box key={idx} height={1} marginLeft={2}>
                  <Text color={ch.color}>{ch.text}</Text>
                </Box>
              ))}
              {hasMore && (
                <Box height={1} marginLeft={2}>
                  <Text color="gray">...</Text>
                </Box>
              )}
            </Box>
          ),
        });
      } else if (entry.kind === "test_result") {
        const isSuccess = entry.failed === 0;
        const statusColor = isSuccess ? "green" : "red";
        const durationSec = (entry.durationMs / 1000).toFixed(1);
        const headerText = `🧪 Tests [${isSuccess ? "Passed" : "Failed"}] (${durationSec}s)`;

        const failureLines: string[] = [];
        if (!isSuccess && entry.failures) {
          for (const f of entry.failures.slice(0, 2)) {
            failureLines.push(`  ✗ ${f.file}:${f.line}`);
            failureLines.push(`    ${f.message.replace(/\s+/g, " ").slice(0, width - 6)}`);
          }
          if (entry.failures.length > 2) {
            failureLines.push(`  ... and ${entry.failures.length - 2} more failures`);
          }
        }

        b.push({
          key: `test-${entry.at}`,
          height: 3 + failureLines.length,
          render: () => (
            <Box key={`test-${entry.at}`} flexDirection="column">
              <Box height={1}>
                <Text bold color={statusColor}>
                  {headerText}
                </Text>
              </Box>
              <Box height={1}>
                <Text color="gray"> Command: {entry.command}</Text>
              </Box>
              <Box height={1}>
                <Text color={statusColor}>
                  {isSuccess ? "  ✓" : "  ✗"} {entry.passed} passed, {entry.failed} failed
                </Text>
              </Box>
              {failureLines.map((fl, idx) => (
                <Box key={idx} height={1}>
                  <Text color={fl.startsWith("    ") ? "gray" : "red"}>{fl}</Text>
                </Box>
              ))}
            </Box>
          ),
        });
      } else if (entry.kind === "card") {
        const statusColor = entry.status === "completed" ? "green" : entry.status === "failed" ? "red" : "yellow";
        const glyphs = {
          completed: { char: "✓", color: "green" },
          failed: { char: "✗", color: "red" },
          running: { char: "▶", color: "yellow" },
          pending: { char: "○", color: "gray" },
          skipped: { char: "–", color: "gray" },
        };
        b.push({
          key: `card-${entry.at}`,
          height: 1 + entry.items.length,
          render: () => (
            <Box key={`card-${entry.at}`} flexDirection="column">
              <Box height={1}>
                <Text bold color={statusColor}>
                  {entry.title} [{entry.status}]
                </Text>
              </Box>
              {entry.items.map((item, idx) => {
                const s = glyphs[item.status] || glyphs.pending;
                return (
                  <Box key={idx} height={1} marginLeft={2}>
                    <Text color={s.color}>{s.char} </Text>
                    <Text>{item.label}</Text>
                    {item.detail && <Text color="gray"> ({item.detail})</Text>}
                  </Box>
                );
              })}
            </Box>
          ),
        });
      }
    }
    flushGroup("end");
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
  const visibleBlocks: Array<{ block: RenderedBlock; startRow: number; endRow: number }> = [];
  let currentRow = blockStart;
  for (let i = firstVisibleIdx; i < blocks.length && currentRow < visibleEnd; i++) {
    const b = blocks[i];
    if (currentRow + b.height > visibleStart) {
      const startRow = Math.max(0, visibleStart - currentRow);
      const endRow = Math.min(b.height, visibleEnd - currentRow);
      visibleBlocks.push({ block: b, startRow, endRow });
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
      // eslint-disable-next-line no-control-regex
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
      <Box height={rows} width={width} flexDirection="column" justifyContent="center" alignItems="center">
        <Text bold color="cyan">
          DevAgent
        </Text>
        <Box height={1} />
        <Text color="gray">Type a message below to start a conversation.</Text>
        <Text color="gray" dimColor>
          /plan {"<goal>"} start a mission · / commands · Ctrl+P palette · 1-5 tabs
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={rows} width={width}>
      {visibleBlocks.map(({ block, startRow, endRow }) => block.render(startRow, endRow))}
    </Box>
  );
}
