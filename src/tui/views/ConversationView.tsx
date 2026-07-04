import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { ChatEntry, RuntimeState } from "../../runtime/types";
import { DetailLevel } from "../../layout/density";
import { tail } from "../../layout/truncate";
import { renderMarkdown, RichLine, Span } from "../markdown";

export interface ViewProps {
  state: RuntimeState;
  width: number;
  rows: number;
  detail: DetailLevel;
}

const ROLE_STYLE: Record<ChatEntry["role"], { label: string; color: string }> = {
  user: { label: "you", color: "green" },
  assistant: { label: "agent", color: "blue" },
  thinking: { label: "think", color: "magenta" },
  tool: { label: "tool", color: "yellow" },
  system: { label: "sys", color: "gray" },
};

function RichText({ spans, role }: { spans: Span[]; role: ChatEntry["role"] }): JSX.Element {
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

/** Conversation: prompts, replies, tool summaries, approval requests. */
export function ConversationView({ state, width, rows, detail }: ViewProps): JSX.Element {
  const [scrollOffset, setScrollOffset] = useState(0);
  const gutter = detail === "compact" ? 0 : 8;
  const bodyWidth = Math.max(10, width - gutter);
  const lines: RichLine[] = [];
  for (const entry of state.conversation) {
    const body = detail === "compact" && entry.role === "thinking" ? "" : entry.text;
    if (!body) continue;
    const entryLines = renderMarkdown(body, entry.role, bodyWidth);
    for (const rl of entryLines) {
      if (lines.length === 0) rl.first = true;
      lines.push(rl);
    }
  }
  const maxOffset = Math.max(0, lines.length - rows);
  const clampedOffset = Math.min(scrollOffset, maxOffset);
  const visible = clampedOffset === 0 ? tail(lines, rows) : lines.slice(lines.length - rows - clampedOffset, lines.length - clampedOffset);

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
  return (
    <Box flexDirection="column" height={rows}>
      {visible.length === 0 ? (
        <Text color="gray">No conversation yet — type below to begin.</Text>
      ) : (
        visible.map((line, i) => {
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
        })
      )}
    </Box>
  );
}
