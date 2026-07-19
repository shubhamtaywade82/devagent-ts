import { CategoryScore, ModelScore } from "./types.js";

export function formatReport(scores: ModelScore[]): string {
  if (scores.length === 0) return "(no benchmark results)";

  const ranked = [...scores].sort((a, b) => b.passRate - a.passRate || a.avgLatencyMs - b.avgLatencyMs);

  const rows = ranked.map((s) => [
    `${s.tier}/${s.model}`,
    `${Math.round(s.passRate * 100)}%`,
    `${Math.round(s.avgLatencyMs)}ms`,
    s.avgTokensPerSec !== null ? `${s.avgTokensPerSec.toFixed(1)} tok/s` : "n/a",
    String(s.cases),
  ]);

  const header = ["model", "pass rate", "avg latency", "avg tok/s", "cases"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));

  const formatRow = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");

  return [formatRow(header), formatRow(widths.map((w) => "-".repeat(w))), ...rows.map(formatRow)].join("\n");
}

export function formatCategoryReport(scores: CategoryScore[]): string {
  if (scores.length === 0) return "(no category results)";

  const ranked = [...scores].sort((a, b) => b.passRate - a.passRate);
  const rows = ranked.map((s) => [s.category, `${Math.round(s.passRate * 100)}%`, String(s.cases)]);
  const header = ["category", "pass rate", "cases"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const formatRow = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");

  return [formatRow(header), formatRow(widths.map((w) => "-".repeat(w))), ...rows.map(formatRow)].join("\n");
}
