import {
  parseInline,
  highlightCodeBlock,
  parseTable,
  renderTable,
  renderSimpleMarkdown,
  renderMarkdown,
} from "../../src/tui/markdown.js";

describe("TUI Markdown Rendering Engine", () => {
  describe("parseInline", () => {
    it("parses bold, italic, code, strikethrough, and links", () => {
      const spans = parseInline("Hello **bold** *italic* `code` ~~deleted~~ [link](https://example.com)");
      expect(spans).toEqual([
        { text: "Hello " },
        { text: "bold", bold: true },
        { text: " " },
        { text: "italic", italic: true },
        { text: " " },
        { text: "code", code: true },
        { text: " " },
        { text: "deleted", strikethrough: true },
        { text: " " },
        { text: "link", bold: true },
        { text: " (https://example.com)", color: "blue", dimColor: true },
      ]);
    });
  });

  describe("highlightCodeBlock", () => {
    it("highlights TypeScript code using cli-highlight", () => {
      const code = "const x: number = 42;";
      const lines = highlightCodeBlock(code, "typescript");
      expect(lines.length).toBeGreaterThan(0);
      expect(lines[0]).toMatch(/const/);
    });

    it("falls back gracefully to plain text for unknown languages", () => {
      const code = "foo bar baz";
      const lines = highlightCodeBlock(code, "unknownlang123");
      expect(lines).toEqual(["foo bar baz"]);
    });
  });

  describe("parseTable & renderTable", () => {
    it("parses GFM Markdown table headers, alignments, and rows", () => {
      const markdownTable = [
        "| Name | Role | Status |",
        "| :--- | :---: | ---: |",
        "| Alice | Dev | Active |",
        "| Bob | Ops | Offline |",
      ];
      const parsed = parseTable(markdownTable);
      expect(parsed).not.toBeNull();
      expect(parsed?.headers).toEqual(["Name", "Role", "Status"]);
      expect(parsed?.alignments).toEqual(["left", "center", "right"]);
      expect(parsed?.rows).toEqual([
        ["Alice", "Dev", "Active"],
        ["Bob", "Ops", "Offline"],
      ]);
    });

    it("renders aligned Unicode box-drawing borders for tables", () => {
      const parsed = parseTable(["| Metric | Value |", "| --- | --- |", "| CPU | 45% |", "| Memory | 2.1GB |"])!;

      const rendered = renderTable(parsed, 60);
      expect(rendered.length).toBe(6); // top, header, mid, row1, row2, bottom
      expect(rendered[0]).toContain("┌");
      expect(rendered[0]).toContain("┬");
      expect(rendered[0]).toContain("┐");
      expect(rendered[rendered.length - 1]).toContain("└");
    });
  });

  describe("renderSimpleMarkdown", () => {
    it("renders fenced code blocks with language title headers and borders", () => {
      const input = '```json\n{\n  "key": "value"\n}\n```';
      const formatted = renderSimpleMarkdown(input, 60);
      expect(formatted.length).toBeGreaterThan(3);
      expect(formatted[0].spans[0].text).toContain("json");
    });

    it("renders Markdown tables as formatted box lines", () => {
      const input = "| Feature | Supported |\n| --- | --- |\n| Highlighting | Yes |";
      const formatted = renderSimpleMarkdown(input, 60);
      expect(formatted.length).toBeGreaterThan(0);
      expect(formatted[0].spans[0].text).toContain("┌");
    });

    it("renders headers with styled prefixes", () => {
      const input = "# Main Title\n## Sub Title";
      const formatted = renderSimpleMarkdown(input, 60);
      expect(formatted.length).toBe(2);
      expect(formatted[0].spans[0].text).toContain("◈ ");
      expect(formatted[1].spans[0].text).toContain("▸ ");
    });

    it("renders task lists with checkbox icons", () => {
      const input = "- [x] Done task\n- [ ] Pending task";
      const formatted = renderSimpleMarkdown(input, 60);
      expect(formatted.length).toBe(2);
      expect(formatted[0].spans[0].text).toContain("✓ ");
      expect(formatted[1].spans[0].text).toContain("○ ");
    });
  });

  describe("renderMarkdown", () => {
    it("produces RichLine items with appropriate role tags", () => {
      const lines = renderMarkdown("# Title\nSome text", "assistant", 60);
      expect(lines.length).toBe(2);
      expect(lines[0].role).toBe("assistant");
      expect(lines[0].first).toBe(true);
      expect(lines[1].first).toBe(false);
    });
  });
});
