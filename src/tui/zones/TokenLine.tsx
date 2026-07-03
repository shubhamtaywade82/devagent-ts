import React from "react";
import { Box, Text } from "ink";
import { StatusToken } from "../../runtime/types";
import { packTokens, TOKEN_SEPARATOR } from "../../layout/status-tokens";

export interface TokenLineProps {
  tokens: StatusToken[];
  width: number;
}

/** Renders a strip of status tokens packed to width, colors preserved. */
export function TokenLine({ tokens, width }: TokenLineProps): JSX.Element {
  const packed = packTokens(tokens, width);
  return (
    <Box height={1}>
      <Text wrap="truncate">
        {packed.map((token, i) => (
          <React.Fragment key={`${token.text}-${i}`}>
            {i > 0 && <Text color="gray">{TOKEN_SEPARATOR}</Text>}
            <Text color={token.color}>{token.text}</Text>
          </React.Fragment>
        ))}
      </Text>
    </Box>
  );
}
