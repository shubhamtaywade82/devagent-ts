import React from "react";
import { Box } from "ink";
import { RuntimeState, ViewId } from "../../runtime/types.js";
import { contextStripTokens } from "../../layout/strips.js";
import { TokenLine } from "./TokenLine.js";

export interface ContextStripProps {
  state: RuntimeState;
  width: number;
  activeView: ViewId;
  now?: number;
}

export function ContextStrip({ state, width, activeView, now }: ContextStripProps): React.JSX.Element {
  return <TokenLine tokens={contextStripTokens(state, activeView, now)} width={width} />;
}
