import React from "react";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { FileTree } from "../../../src/tui/panes/FileTree";

describe("FileTree", () => {
  it("lists top-level entries from the workspace root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-"));
    await writeFile(join(dir, "a.ts"), "x");
    await mkdir(join(dir, "sub"));

    const { lastFrame, unmount } = render(<FileTree root={dir} onSelect={() => {}} focused={false} />);
    await new Promise((r) => setTimeout(r, 20));

    expect(lastFrame()).toContain("a.ts");
    expect(lastFrame()).toContain("sub");
    unmount();
  });
});
