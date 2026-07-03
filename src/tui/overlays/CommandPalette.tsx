import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { CommandEffect, SlashCommandRegistry } from "../../interaction/slash-commands";
import { VIEW_ORDER } from "../../runtime/types";
import { OverlayFrame } from "./OverlayFrame";

export interface PaletteAction {
  label: string;
  detail: string;
  effect: CommandEffect;
}

export function paletteActions(registry: SlashCommandRegistry): PaletteAction[] {
  const viewActions: PaletteAction[] = VIEW_ORDER.map((view, i) => ({
    label: `Focus: ${view}`,
    detail: `Key ${i + 1}`,
    effect: { kind: "focus-view", view },
  }));
  const commandActions: PaletteAction[] = registry
    .all()
    .map((c) => ({ label: `/${c.name}`, detail: c.description, effect: c.execute("") }));
  return [...viewActions, ...commandActions];
}

export function filterActions(actions: PaletteAction[], query: string): PaletteAction[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return actions;
  return actions.filter((a) => terms.every((t) => `${a.label} ${a.detail}`.toLowerCase().includes(t)));
}

export interface CommandPaletteProps {
  registry: SlashCommandRegistry;
  width: number;
  rows: number;
  active: boolean;
  onAction(effect: CommandEffect): void;
}

/** Ctrl+P — global searchable action palette (actions, not commands). */
export function CommandPalette({ registry, width, rows, active, onAction }: CommandPaletteProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const actions = filterActions(paletteActions(registry), query);
  const visibleCount = Math.max(3, rows - 5);
  const clampedIndex = Math.min(index, Math.max(0, actions.length - 1));
  const start = Math.max(0, Math.min(clampedIndex - visibleCount + 1, actions.length - visibleCount));
  const visible = actions.slice(start, start + visibleCount);

  useInput(
    (input, key) => {
      if (key.upArrow) {
        setIndex((i) => Math.max(0, Math.min(i, actions.length - 1) - 1));
      } else if (key.downArrow) {
        setIndex((i) => Math.min(actions.length - 1, i + 1));
      } else if (key.return) {
        const action = actions[clampedIndex];
        if (action) onAction(action.effect);
      } else if (key.backspace || key.delete) {
        setQuery((q) => q.slice(0, -1));
        setIndex(0);
      } else if (input && !key.ctrl && !key.meta && !key.tab && !key.escape) {
        setQuery((q) => q + input);
        setIndex(0);
      }
    },
    { isActive: active },
  );

  return (
    <OverlayFrame title="Command Palette" width={width} rows={rows}>
      <Text>
        <Text color="green">{"> "}</Text>
        {query}
        <Text inverse> </Text>
      </Text>
      {visible.map((action, i) => {
        const selected = start + i === clampedIndex;
        return (
          <Box key={action.label}>
            <Text color={selected ? "blue" : undefined} inverse={selected} wrap="truncate">
              {action.label}
            </Text>
            <Text color="gray" wrap="truncate">
              {"  "}
              {action.detail}
            </Text>
          </Box>
        );
      })}
      {actions.length === 0 && <Text color="gray">No matching actions.</Text>}
    </OverlayFrame>
  );
}
