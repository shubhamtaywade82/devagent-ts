import React from "react";
import { Box, Text } from "ink";
import { ViewProps } from "./ConversationView";

export function RailsView({ state, width, rows }: ViewProps): JSX.Element {
  const rails = state.rails;

  if (!rails || rails.status === "disabled") {
    return (
      <Box flexDirection="column" height={rows}>
        <Text color="gray">Rails project not detected. Start working in a Rails project to see Rails-specific information.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={rows}>
      <Box height={1} marginBottom={1}>
        <Text bold>Rails Project</Text>
      </Box>
      <Box height={1}>
        <Text>
          <Text bold>Index: </Text>
          <Text color={rails.status === "ready" ? "green" : rails.status === "error" ? "red" : "yellow"}>
            {rails.status}
          </Text>
        </Text>
      </Box>
      <Box height={1}>
        <Text>
          <Text bold>Entities: </Text>
          <Text>{rails.entityCount}</Text>
        </Text>
      </Box>
      <Box height={1}>
        <Text>
          <Text bold>Relationships: </Text>
          <Text>{rails.edgeCount}</Text>
        </Text>
      </Box>
      {rails.scannerErrors.length > 0 && (
        <>
          <Box height={1} marginTop={1}>
            <Text bold color="red">
              Scanner Errors ({rails.scannerErrors.length})
            </Text>
          </Box>
          {rails.scannerErrors.slice(0, rows - 6).map((err, i) => (
            <Box key={i} height={1} marginLeft={2}>
              <Text color="red" wrap="truncate">
                {err.slice(0, width - 6)}
              </Text>
            </Box>
          ))}
        </>
      )}
    </Box>
  );
}
