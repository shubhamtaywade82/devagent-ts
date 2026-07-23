import React from "react";
import { Text } from "ink";
import { Span } from "../markdown.js";

/** Renders one markdown-parsed line's spans (see markdown.ts). */
export function SpanText({ spans }: { spans: Span[] }): React.JSX.Element {
  return (
    <Text wrap="truncate">
      {spans.map((s, j) => {
        if (s.ansi) return <Text key={j}>{s.text}</Text>;
        if (s.code) return <Text key={j} color="yellow">{` ${s.text} `}</Text>;
        return (
          <Text
            key={j}
            bold={s.bold}
            italic={s.italic}
            strikethrough={s.strikethrough}
            color={s.color as any}
            dimColor={s.dimColor}
          >
            {s.text}
          </Text>
        );
      })}
    </Text>
  );
}
