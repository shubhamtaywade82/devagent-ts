import React from "react";
import { Box, Text } from "ink";
import { ChatEntry } from "../state";
import { PlanStep } from "../../orchestrator/types";

export interface ChatPlanProps {
  chat: ChatEntry[];
  planSteps: PlanStep[] | null;
  focused: boolean;
}

const ROLE_COLOR: Record<ChatEntry["role"], string> = {
  user: "green",
  assistant: "white",
  thinking: "gray",
};

export function ChatPlan({ chat, planSteps, focused }: ChatPlanProps): JSX.Element {
  return (
    <Box flexDirection="column" borderStyle={focused ? "double" : "single"}>
      <Text bold color="cyan">
        CHAT / PLAN
      </Text>
      {planSteps ? (
        <Box flexDirection="column">
          {planSteps.map((step, i) => (
            <Text key={step.id}>
              {step.status === "completed" ? "[x]" : "[ ]"} {i + 1}. {step.description}
              {step.status === "failed" ? " (failed)" : ""}
            </Text>
          ))}
          <Text dimColor>
            {planSteps.filter((s) => s.status === "completed").length} / {planSteps.length} completed
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {chat.map((entry, i) => (
            <Text key={i} color={ROLE_COLOR[entry.role]}>
              {entry.role === "user" ? "You: " : entry.role === "thinking" ? "(thinking) " : "DevAgent: "}
              {entry.text}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
