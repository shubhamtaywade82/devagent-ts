import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import {
  ClarificationOption,
  ClarificationRequest,
  ClarificationResponse,
} from "@nemesis-oss/nexum-core/runtime/types";
import { OverlayFrame } from "./OverlayFrame.js";

export interface ClarificationOverlayProps {
  request: ClarificationRequest;
  width: number;
  rows: number;
  onSubmit(response: ClarificationResponse): void;
  onCancel(): void;
}

export function ClarificationOverlay({
  request,
  width,
  rows,
  onSubmit,
  onCancel,
}: ClarificationOverlayProps): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState("");

  const handleCustomInput = (input: string, key: import("ink").Key) => {
    if (key.return) {
      onSubmit({ id: request.id, selectedId: "custom", customText });
    } else if (key.escape) {
      setCustomMode(false);
    } else if (key.backspace || key.delete) {
      setCustomText((t) => t.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta) {
      setCustomText((t) => t + input);
    }
  };

  const handleSelectionInput = (input: string, key: import("ink").Key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(request.options.length - 1, i + 1));
    } else if (key.return) {
      const opt = request.options[selectedIndex];
      if (opt?.isCustom) setCustomMode(true);
      else if (opt) onSubmit({ id: request.id, selectedId: opt.id });
    } else if (/^[1-9]$/.test(input)) {
      const idx = parseInt(input, 10) - 1;
      const opt = request.options[idx];
      if (opt?.isCustom) setCustomMode(true);
      else if (opt) onSubmit({ id: request.id, selectedId: opt.id });
    }
  };

  useInput((input, key) => {
    if (customMode) handleCustomInput(input, key);
    else handleSelectionInput(input, key);
  });

  return (
    <OverlayFrame title="Intent Clarification" width={width} rows={rows}>
      <Box flexDirection="column" marginY={1}>
        <Text bold color="cyan">
          {request.question}
        </Text>
        <Text color="gray" dimColor>
          Prompt: &quot;{request.prompt}&quot;
        </Text>
      </Box>

      {customMode ? (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
          <Text bold color="yellow">
            Enter your custom instructions:
          </Text>
          <Box marginTop={1}>
            <Text color="green">&gt; </Text>
            <Text>{customText}</Text>
            <Text inverse> </Text>
          </Box>
          <Box marginTop={1}>
            <Text color="gray" dimColor>
              Press Enter to submit, Esc to return to options
            </Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" marginY={1}>
          {request.options.map((opt: ClarificationOption, idx: number) => {
            const isSelected = idx === selectedIndex;
            return (
              <Box key={opt.id} flexDirection="row">
                <Text color={isSelected ? "green" : "gray"}>
                  {isSelected ? "▶ " : "  "}
                  <Text bold color={isSelected ? "white" : "yellow"}>
                    [{idx + 1}]{" "}
                  </Text>
                  <Text bold={isSelected} color={isSelected ? "cyan" : undefined}>
                    {opt.label}
                  </Text>
                  {opt.detail ? <Text color="gray"> — {opt.detail}</Text> : null}
                </Text>
              </Box>
            );
          })}
          <Box marginTop={1}>
            <Text color="gray" dimColor>
              Use ↑/↓ or 1-{request.options.length} to select, Enter to confirm, Esc to dismiss
            </Text>
          </Box>
        </Box>
      )}
    </OverlayFrame>
  );
}
