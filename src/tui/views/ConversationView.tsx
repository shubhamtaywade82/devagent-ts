import React from "react";
import { Box, Text } from "ink";
import { ChatEntry, RuntimeState } from "../../runtime/types";
import { DetailLevel } from "../../layout/density";
import { tail, wrapText } from "../../layout/truncate";

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

/** Conversation: prompts, replies, tool summaries, approval requests. */
export function ConversationView({ state, width, rows, detail }: ViewProps): JSX.Element {
  const gutter = detail === "compact" ? 0 : 8;
  const bodyWidth = Math.max(10, width - gutter);
  const lines: { role: ChatEntry["role"]; text: string; first: boolean }[] = [];
  for (const entry of state.conversation) {
    const body = detail === "compact" && entry.role === "thinking" ? "" : entry.text;
    if (!body) continue;
    wrapText(body, bodyWidth).forEach((line, i) => {
      lines.push({ role: entry.role, text: line, first: i === 0 });
    });
  }
  const visible = tail(lines, rows);
  return (
    <Box flexDirection="column" height={rows}>
      {visible.length === 0 ? (
        <Text color="gray">No conversation yet — type below to begin.</Text>
      ) : (
        visible.map((line, i) => {
          const style = ROLE_STYLE[line.role];
          return (
            <Box key={i} height={1}>
              {gutter > 0 && (
                <Box width={gutter}>
                  <Text color={style.color} dimColor={!line.first}>
                    {line.first ? `${style.label} ▸ ` : ""}
                  </Text>
                </Box>
              )}
              <Text
                wrap="truncate"
                color={line.role === "thinking" ? "gray" : undefined}
                italic={line.role === "thinking"}
              >
                {line.text}
              </Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}
