import React from "react";
import { Box, Text } from "ink";
import { ACTOR_IDS, RuntimeState } from "../../runtime/types";
import { semanticColor } from "../../layout/theme-map";
import { OverlayFrame } from "./OverlayFrame";

export interface ActorsOverlayProps {
  state: RuntimeState;
  width: number;
  rows: number;
}

export function ActorsOverlay({ state, width, rows }: ActorsOverlayProps): JSX.Element {
  return (
    <OverlayFrame title="Actors — all alive" width={width} rows={rows}>
      {ACTOR_IDS.map((id) => {
        const actor = state.actors[id];
        return (
          <Box key={id}>
            <Box width={14}>
              <Text>{id}</Text>
            </Box>
            <Box width={10}>
              <Text color={semanticColor(actor.health)}>{actor.health}</Text>
            </Box>
            <Text color="gray">{actor.detail}</Text>
          </Box>
        );
      })}
    </OverlayFrame>
  );
}
