/** Lightweight syntax / structure checks before applying patches/writes. */

function matches(open: string, close: string): boolean {
  return (
    (open === "(" && close === ")") ||
    (open === "[" && close === "]") ||
    (open === "{" && close === "}")
  );
}

function checkBalanced(content: string, label: string): { ok: boolean; error?: string } {
  const stack: string[] = [];
  let inStr: '"' | "'" | "`" | null = null;
  let esc = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < content.length; i++) {
    const c = content[i]!;
    const next = content[i + 1];

    if (lineComment) {
      if (c === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (c === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (c === "\\") {
        esc = true;
      } else if (c === inStr) {
        inStr = null;
      }
      continue;
    }

    if (c === "/" && next === "/") {
      lineComment = true;
      i += 1;
    } else if (c === "/" && next === "*") {
      blockComment = true;
      i += 1;
    } else if (c === '"' || c === "'" || c === "`") {
      inStr = c;
    } else if (c === "(" || c === "[" || c === "{") {
      stack.push(c);
    } else if (c === ")" || c === "]" || c === "}") {
      const open = stack.pop();
      if (!open || !matches(open, c)) {
        return { ok: false, error: `${label} syntax: unmatched '${c}'` };
      }
    }
  }

  if (inStr) return { ok: false, error: `${label} syntax: unclosed string` };
  if (stack.length) return { ok: false, error: `${label} syntax: unclosed '${stack[stack.length - 1]}'` };
  return { ok: true };
}

function checkPythonLite(content: string): { ok: boolean; error?: string } {
  const triples = content.match(/'''|"""/g) ?? [];
  if (triples.length % 2 !== 0) {
    return { ok: false, error: "Python syntax: unbalanced triple quotes" };
  }
  return checkBalanced(content.replace(/'''[\s\S]*?'''|"""[\s\S]*?"""/g, '""'), "Python");
}

export function validateSyntax(path: string, content: string): { ok: boolean; error?: string } {
  if (content.includes("\0")) return { ok: false, error: "content contains null bytes" };

  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) {
    try {
      JSON.parse(content);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (/\.(js|jsx|ts|tsx|mjs|cjs)$/i.test(lower)) {
    return checkBalanced(content, "JS/TS");
  }

  if (lower.endsWith(".py")) {
    return checkPythonLite(content);
  }

  if (lower.endsWith(".rb")) {
    return checkBalanced(content, "Ruby");
  }

  if (/[\uFFFE\uFFFF]/.test(content)) return { ok: false, error: "content contains illegal unicode" };
  return { ok: true };
}
