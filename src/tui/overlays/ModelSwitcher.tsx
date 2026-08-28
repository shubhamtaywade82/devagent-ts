import React from "react";
import { Box, Text } from "ink";
import { UniversalPicker } from "./UniversalPicker.js";
import { OverlayFrame } from "./OverlayFrame.js";

export interface ModelSwitcherProps {
  current: string;
  models: string[] | null; // null = still loading
  /** Cache-only: model id -> known accessible (true) / subscription-gated (false). Absent = unchecked. */
  availability?: Record<string, boolean>;
  /** coding/vision/reasoning/quick/tools/agentic tags per model. */
  capabilities?: Record<string, string[]>;
  width: number;
  rows: number;
  active: boolean;
  onSelect(model: string): void;
}

// Short forms so the capability list doesn't crowd out the model name at
// typical terminal widths.
const CAP_SHORT: Record<string, string> = {
  coding: "code",
  vision: "vision",
  reasoning: "reason",
  quick: "quick",
  tools: "tools",
  agentic: "agentic",
};

/** Ctrl+M — switch model via the universal picker. */
export function ModelSwitcher({ current, models, availability, capabilities, width, rows, active, onSelect }: ModelSwitcherProps): React.JSX.Element {
  if (models === null) {
    return (
      <OverlayFrame title="Switch Model" width={width} rows={rows}>
        <Box>
          <Text color="magenta">Loading models…</Text>
        </Box>
      </OverlayFrame>
    );
  }
  const all = models.includes(current) || !current ? models : [current, ...models];
  const detailFor = (m: string): string | undefined => {
    const known = availability?.[m];
    const status = m === current ? "current" : known === true ? "Free" : known === false ? "🔒 Subscription" : "Untested";
    const caps = capabilities?.[m]?.map((c) => CAP_SHORT[c] ?? c).join("/");
    return caps ? `${status} · ${caps}` : status;
  };
  return (
    <UniversalPicker
      title="Switch Model"
      items={all.map((m) => ({ id: m, label: m, detail: detailFor(m) }))}
      width={width}
      rows={rows}
      active={active}
      placeholder="Type to filter models…"
      emptyText="No models available — is the provider reachable?"
      initialSelected={current ? [current] : []}
      onSubmit={(ids) => {
        if (ids[0]) onSelect(ids[0]);
      }}
    />
  );
}
