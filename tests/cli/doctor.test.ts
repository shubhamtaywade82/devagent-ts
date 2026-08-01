import { runDoctor } from "../../src/cli/doctor.js";

describe("CLI - Doctor", () => {
  it("runs doctor diagnostic check successfully", async () => {
    const report = await runDoctor();
    expect(report.ok).toBe(true);
    expect(report.lines.some((l) => l.startsWith("workspaceRoot:"))).toBe(true);
    expect(report.lines.some((l) => l.startsWith("lsp:"))).toBe(true);
  });
});
