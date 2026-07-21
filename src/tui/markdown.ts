import { highlight, supportsLanguage } from "cli-highlight";
import chalk from "chalk";
import { wrapText } from "../layout/truncate.js";

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  ansi?: boolean;
  color?: string;
  dimColor?: boolean;
  strikethrough?: boolean;
}

export interface FormattedLine {
  spans: Span[];
  indent?: number;
}

export interface RichLine {
  role: "user" | "assistant" | "thinking" | "tool" | "system";
  spans: Span[];
  /** True if this is the first visual line of a chat entry — shows the role label. */
  first: boolean;
  /** Extra left padding for code blocks, blockquotes, etc. */
  indent?: number;
}

const INLINE_RE = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+)`)|(~~(.+?)~~)|(\[(.+?)\]\((.+?)\))/g;

export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index) });
    if (m[2]) spans.push({ text: m[2], bold: true });
    else if (m[4]) spans.push({ text: m[4], italic: true });
    else if (m[6]) spans.push({ text: m[6], code: true });
    else if (m[8]) spans.push({ text: m[8], strikethrough: true });
    else if (m[10] && m[11]) {
      spans.push({ text: m[10], bold: true });
      spans.push({ text: ` (${m[11]})`, color: "blue", dimColor: true });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans;
}

export function highlightCodeBlock(code: string, lang?: string): string[] {
  const trimmedLang = lang?.trim().toLowerCase();
  const validLang = trimmedLang && supportsLanguage(trimmedLang) ? trimmedLang : undefined;
  try {
    const highlighted = highlight(code, {
      language: validLang,
      ignoreIllegals: true,
    });
    return highlighted.split("\n");
  } catch {
    return code.split("\n");
  }
}

export interface TableData {
  headers: string[];
  alignments: Array<"left" | "center" | "right">;
  rows: string[][];
}

export function parseTable(lines: string[]): TableData | null {
  if (lines.length < 2) return null;

  const parseRow = (line: string): string[] => {
    const trimmed = line.trim().replace(/^\||\|$/g, "");
    return trimmed.split("|").map((cell) => cell.trim());
  };

  const headers = parseRow(lines[0]);
  if (headers.length === 0) return null;

  const delimiterLine = lines[1];
  if (!delimiterLine.includes("-")) return null;

  const delimiterCells = parseRow(delimiterLine);
  const alignments: Array<"left" | "center" | "right"> = headers.map((_, idx) => {
    const d = delimiterCells[idx] || "";
    if (d.startsWith(":") && d.endsWith(":")) return "center";
    if (d.endsWith(":")) return "right";
    return "left";
  });

  const rows = lines.slice(2).map(parseRow);
  return { headers, alignments, rows };
}

export function renderTable(table: TableData, maxWidth: number): string[] {
  const numCols = table.headers.length;
  if (numCols === 0) return [];

  const minWidthPerCol = 4;
  const borderOverhead = numCols + 1;
  const availableWidth = Math.max(numCols * minWidthPerCol, maxWidth - borderOverhead);

  const contentWidths = new Array(numCols).fill(0);
  table.headers.forEach((h, i) => {
    contentWidths[i] = Math.max(contentWidths[i] || 0, h.length);
  });
  table.rows.forEach((row) => {
    row.forEach((cell, i) => {
      if (i < numCols) {
        contentWidths[i] = Math.max(contentWidths[i] || 0, (cell || "").length);
      }
    });
  });

  let totalRawWidth = contentWidths.reduce((a, b) => a + b, 0);
  if (totalRawWidth === 0) totalRawWidth = 1;

  const colWidths = contentWidths.map((w) => {
    const proportional = Math.floor((w / totalRawWidth) * availableWidth);
    return Math.max(minWidthPerCol, proportional);
  });

  const padCell = (text: string, width: number, align: "left" | "center" | "right") => {
    if (text.length > width) {
      return text.slice(0, Math.max(1, width - 1)) + "…";
    }
    const padTotal = width - text.length;
    if (align === "right") {
      return " ".repeat(padTotal) + text;
    }
    if (align === "center") {
      const left = Math.floor(padTotal / 2);
      const right = padTotal - left;
      return " ".repeat(left) + text + " ".repeat(right);
    }
    return text + " ".repeat(padTotal);
  };

  const topBorder = chalk.gray("┌" + colWidths.map((w) => "─".repeat(w + 2)).join("┬") + "┐");
  const headerRow =
    chalk.gray("│") +
    table.headers
      .map((h, i) => {
        const padded = padCell(h, colWidths[i], table.alignments[i]);
        return ` ${chalk.bold.cyan(padded)} ` + chalk.gray("│");
      })
      .join("");

  const midBorder = chalk.gray("├" + colWidths.map((w) => "─".repeat(w + 2)).join("┼") + "┤");

  const formattedRows = table.rows.map((row) => {
    return (
      chalk.gray("│") +
      colWidths
        .map((w, i) => {
          const cellText = row[i] || "";
          const padded = padCell(cellText, w, table.alignments[i]);
          return ` ${padded} ` + chalk.gray("│");
        })
        .join("")
    );
  });

  const bottomBorder = chalk.gray("└" + colWidths.map((w) => "─".repeat(w + 2)).join("┴") + "┘");

  return [topBorder, headerRow, midBorder, ...formattedRows, bottomBorder];
}

export function renderSimpleMarkdown(text: string, bodyWidth: number): FormattedLine[] {
  const rawLines = text.split("\n");
  const result: FormattedLine[] = [];
  const width = Math.max(10, bodyWidth);

  let idx = 0;
  while (idx < rawLines.length) {
    const raw = rawLines[idx];
    const trimmed = raw.trim();

    // 1. Fenced Code Blocks (```lang ... ```)
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      idx++;
      while (idx < rawLines.length && !rawLines[idx].trim().startsWith("```")) {
        codeLines.push(rawLines[idx]);
        idx++;
      }
      if (idx < rawLines.length) idx++; // skip closing ```

      const langLabel = lang ? ` ${lang} ` : " code ";
      const headerBar = chalk.gray(
        `┌──${chalk.bold.yellow(langLabel)}${"─".repeat(Math.max(0, width - 4 - langLabel.length))}┐`,
      );
      const footerBar = chalk.gray(`└${"─".repeat(Math.max(0, width - 2))}┘`);

      result.push({ spans: [{ text: headerBar, ansi: true }] });

      const highlighted = highlightCodeBlock(codeLines.join("\n"), lang);
      for (const line of highlighted) {
        const borderLine = chalk.gray("│ ") + line;
        result.push({ spans: [{ text: borderLine, ansi: true }] });
      }

      result.push({ spans: [{ text: footerBar, ansi: true }] });
      continue;
    }

    // 2. Markdown Tables (| Col 1 | Col 2 |)
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableLines: string[] = [];
      while (idx < rawLines.length && rawLines[idx].trim().startsWith("|")) {
        tableLines.push(rawLines[idx]);
        idx++;
      }
      const tableData = parseTable(tableLines);
      if (tableData) {
        const rendered = renderTable(tableData, width - 2);
        for (const line of rendered) {
          result.push({ spans: [{ text: line, ansi: true }], indent: 1 });
        }
        continue;
      }
    }

    // 3. Empty lines
    if (!trimmed) {
      result.push({ spans: [{ text: "" }] });
      idx++;
      continue;
    }

    // 4. Headings (#, ##, ###, ####)
    if (raw.startsWith("#")) {
      const level = raw.match(/^#+/)?.[0].length || 1;
      const content = raw.replace(/^#+\s*/, "");
      let prefix = "◈ ";
      let prefixColor = chalk.bold.cyan;

      if (level === 2) {
        prefix = "▸ ";
        prefixColor = chalk.bold.yellow;
      } else if (level === 3) {
        prefix = "• ";
        prefixColor = chalk.bold.green;
      } else if (level >= 4) {
        prefix = "◦ ";
        prefixColor = chalk.bold.magenta;
      }

      for (const line of wrapText(content, width - 4)) {
        result.push({
          spans: [
            { text: prefixColor(prefix), ansi: true },
            ...parseInline(line).map((s) => ({ ...s, bold: true })),
          ],
        });
      }
      idx++;
      continue;
    }

    // 5. Task list items (- [ ] / - [x])
    if (raw.match(/^[-*]\s+\[([ xX])\]\s/)) {
      const isChecked = raw.includes("[x]") || raw.includes("[X]");
      const content = raw.replace(/^[-*]\s+\[([ xX])\]\s/, "");
      const checkGlyph = isChecked ? chalk.green("✓ ") : chalk.gray("○ ");
      for (const line of wrapText(content, width - 4)) {
        result.push({
          spans: [{ text: checkGlyph, ansi: true }, ...parseInline(line)],
          indent: 2,
        });
      }
      idx++;
      continue;
    }

    // 6. Bullet lists (- / *)
    if (raw.match(/^[-*]\s/)) {
      const content = raw.replace(/^[-*]\s/, "");
      const bulletGlyph = chalk.cyan("• ");
      for (const line of wrapText(content, width - 4)) {
        result.push({
          spans: [{ text: bulletGlyph, ansi: true }, ...parseInline(line)],
          indent: 2,
        });
      }
      idx++;
      continue;
    }

    // 7. Numbered lists (1., 2.)
    const numMatch = raw.match(/^(\d+)\.\s/);
    if (numMatch) {
      const numStr = numMatch[1];
      const content = raw.replace(/^\d+\.\s/, "");
      const numGlyph = chalk.cyan(`${numStr}. `);
      for (const line of wrapText(content, width - 4)) {
        result.push({
          spans: [{ text: numGlyph, ansi: true }, ...parseInline(line)],
          indent: 2,
        });
      }
      idx++;
      continue;
    }

    // 8. Blockquotes (> )
    if (raw.startsWith("> ")) {
      const content = raw.replace(/^>\s*/, "");
      const quoteBar = chalk.gray("│ ");
      for (const line of wrapText(content, width - 4)) {
        result.push({
          spans: [
            { text: quoteBar, ansi: true },
            ...parseInline(line).map((s) => ({ ...s, italic: true, color: "gray" })),
          ],
          indent: 1,
        });
      }
      idx++;
      continue;
    }

    // 9. Standard body text
    for (const line of wrapText(raw, width)) {
      result.push({ spans: parseInline(line) });
    }
    idx++;
  }

  return result;
}

export function renderMarkdown(text: string, role: RichLine["role"], bodyWidth: number): RichLine[] {
  const formatted = renderSimpleMarkdown(text, bodyWidth);
  return formatted.map((line, idx) => ({
    role,
    spans: line.spans,
    first: idx === 0,
    indent: line.indent,
  }));
}
