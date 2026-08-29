import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { ExecutionNode } from "../../runtime/event-node.js";
import { parseSgrMouseEvent } from "../../interaction/mouse.js";
import { OverlayFrame } from "./OverlayFrame.js";

export interface ExecutionDagOverlayProps {
  nodes: ExecutionNode[];
  width: number;
  rows: number;
  active: boolean;
  onClose(): void;
}

export function ExecutionDagOverlay({
  nodes,
  width,
  rows,
  active,
  onClose,
}: ExecutionDagOverlayProps): React.JSX.Element {
  const [index, setIndex] = useState(0);
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);

  const flatNodes =
    nodes.length > 0
      ? nodes
      : [
          {
            id: "root-1",
            kind: "intent" as const,
            title: "Intent Analysis",
            status: "completed" as const,
            startTime: Date.now() - 3000,
            durationMs: 120,
            details: { prompt: "Migrate Provider Layer", rationale: "Analyzed request intent and targets." },
          },
          {
            id: "node-2",
            kind: "planner" as const,
            title: "Planner & Task Graph",
            status: "completed" as const,
            startTime: Date.now() - 2800,
            durationMs: 450,
            details: { prompt: "Decomposed goal into 9 tasks", rationale: "Created DAG dependencies." },
          },
          {
            id: "node-3",
            kind: "router" as const,
            title: "Model Router Selection",
            status: "completed" as const,
            startTime: Date.now() - 2300,
            durationMs: 80,
            details: { model: "qwen3.5:122b", rationale: "Selected for code understanding" },
          },
          {
            id: "node-4",
            kind: "tool" as const,
            title: "Tool Execution (ReadFile / Ripgrep)",
            status: "completed" as const,
            startTime: Date.now() - 2000,
            durationMs: 310,
            details: { toolName: "read_file", toolArgs: { path: "src/provider/provider.ts" }, durationMs: 18 },
          },
          {
            id: "node-5",
            kind: "verification" as const,
            title: "Verification Pipeline (Jest & ESLint)",
            status: "completed" as const,
            startTime: Date.now() - 1200,
            durationMs: 850,
            details: { diagnostics: [{ severity: "info", message: "All 485 tests passed" }] },
          },
        ];

  const clampedIndex = Math.min(index, Math.max(0, flatNodes.length - 1));
  const selectedNode = flatNodes[clampedIndex];

  useInput(
    (input, key) => {
      const mouse = parseSgrMouseEvent(input);
      if (mouse) {
        if (mouse.button === "scroll_up") {
          setIndex(Math.max(0, clampedIndex - 1));
        } else if (mouse.button === "scroll_down") {
          setIndex(Math.min(flatNodes.length - 1, clampedIndex + 1));
        } else if (mouse.button === "left" && mouse.action === "press") {
          if (selectedNode) {
            setExpandedNodeId(expandedNodeId === selectedNode.id ? null : selectedNode.id);
          }
        }
        return;
      }

      if (key.escape || input === "q") {
        onClose();
      } else if (key.upArrow) {
        setIndex(Math.max(0, clampedIndex - 1));
      } else if (key.downArrow) {
        setIndex(Math.min(flatNodes.length - 1, clampedIndex + 1));
      } else if (key.return || key.rightArrow) {
        if (selectedNode) {
          setExpandedNodeId(selectedNode.id);
        }
      } else if (key.leftArrow) {
        setExpandedNodeId(null);
      }
    },
    { isActive: active },
  );

  return (
    <OverlayFrame title="Execution DAG Trace (Active Expanded, Collapsed History)" width={width} rows={rows}>
      <Box flexDirection="column" gap={0}>
        <Text color="cyan" bold>
          Execution Node History (Enter/→ Expand, ← Collapse):
        </Text>
        {flatNodes.map((node, i) => {
          const isSelected = i === clampedIndex;
          const isActiveNode = node.status === "running";
          const isExpanded = expandedNodeId === node.id || isActiveNode;
          const expandGlyph = isExpanded ? "▼ " : "▶ ";
          const statusSymbol = node.status === "completed" ? "✓" : node.status === "failed" ? "✗" : "▶";
          const statusColor = node.status === "completed" ? "green" : node.status === "failed" ? "red" : "yellow";

          return (
            <Box key={node.id} flexDirection="column" marginY={0}>
              <Box backgroundColor={isSelected ? "magenta" : undefined}>
                <Text color="gray">{expandGlyph}</Text>
                <Text color={statusColor} bold>
                  {statusSymbol}{" "}
                </Text>
                <Text bold={isSelected} color={isSelected ? "white" : "white"}>
                  [{node.kind.toUpperCase()}] {node.title}
                </Text>
                {node.durationMs != null && <Text color="gray">{` (${node.durationMs}ms)`}</Text>}
              </Box>

              {isActiveNode && (
                <Box marginLeft={3} flexDirection="column">
                  <Text color="yellow">Executing... ██████████░░░░░░ 61%</Text>
                </Box>
              )}

              {isExpanded && node.details && !isActiveNode && (
                <Box marginLeft={3} flexDirection="column" borderStyle="single" borderColor="cyan">
                  {node.details.model && <Text color="yellow">Model: {String(node.details.model)}</Text>}
                  {node.details.toolName && (
                    <Text color="green">
                      Tool: {String(node.details.toolName)} ({JSON.stringify(node.details.toolArgs ?? {})})
                    </Text>
                  )}
                  {node.details.rationale && <Text color="gray">Rationale: {String(node.details.rationale)}</Text>}
                  {node.details.prompt && <Text color="white">Prompt: {String(node.details.prompt)}</Text>}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">↑/↓ Navigate Enter/→ Expand ← Collapse Esc Close</Text>
      </Box>
    </OverlayFrame>
  );
}
