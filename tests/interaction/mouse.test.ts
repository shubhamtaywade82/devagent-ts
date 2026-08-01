import { parseSgrMouseEvent, MOUSE_SGR_PATTERN } from "../../src/interaction/mouse.js";

describe("Mouse SGR Event Parser", () => {
  it("detects SGR mouse pattern", () => {
    expect(MOUSE_SGR_PATTERN.test("\x1b[<64;20;10M")).toBe(true);
    expect(MOUSE_SGR_PATTERN.test("normal text")).toBe(false);
  });

  it("parses scroll_up and scroll_down mouse events", () => {
    const scrollUp = parseSgrMouseEvent("\x1b[<64;15;25M");
    expect(scrollUp).not.toBeNull();
    expect(scrollUp?.button).toBe("scroll_up");
    expect(scrollUp?.x).toBe(15);
    expect(scrollUp?.y).toBe(25);

    const scrollDown = parseSgrMouseEvent("\x1b[<65;15;25M");
    expect(scrollDown).not.toBeNull();
    expect(scrollDown?.button).toBe("scroll_down");
  });

  it("parses left click press and release events", () => {
    const press = parseSgrMouseEvent("\x1b[<0;10;5M");
    expect(press).not.toBeNull();
    expect(press?.button).toBe("left");
    expect(press?.action).toBe("press");

    const release = parseSgrMouseEvent("\x1b[<0;10;5m");
    expect(release).not.toBeNull();
    expect(release?.button).toBe("left");
    expect(release?.action).toBe("release");
  });
});
