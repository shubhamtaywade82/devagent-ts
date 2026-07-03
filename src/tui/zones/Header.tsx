import React from "react";
import { RuntimeState } from "../../runtime/types";
import { headerTokens } from "../../layout/strips";
import { TokenLine } from "./TokenLine";

export interface HeaderProps {
  state: RuntimeState;
  width: number;
  now?: number;
}

export function Header({ state, width, now }: HeaderProps): JSX.Element {
  return <TokenLine tokens={headerTokens(state, now)} width={width} />;
}
