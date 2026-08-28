const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "your",
  "have",
  "has",
  "are",
  "was",
  "were",
  "been",
  "will",
  "can",
  "not",
  "but",
  "all",
  "any",
  "out",
  "use",
  "using",
  "used",
]);

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

export function goalOverlap(goal: string, ...parts: string[]): number {
  const g = tokenize(goal);
  if (!g.size) return 0;
  const hay = tokenize(parts.join(" "));
  if (!hay.size) return 0;
  let hits = 0;
  for (const t of g) {
    if (hay.has(t)) hits += 1;
  }
  return hits / g.size;
}

export function looksLikeRepoDump(text: string): boolean {
  const lines = text.split(/\r?\n/);
  if (lines.length < 200) return false;
  let pathish = 0;
  for (const line of lines.slice(0, 400)) {
    if (/^[\w./-]+\.(ts|tsx|js|jsx|py|rb|go|rs|java|md)\b/.test(line.trim()) || /^\s*diff --git /.test(line)) {
      pathish += 1;
    }
  }
  return pathish >= 40;
}
