import { activeViewRows, densityForWidth, detailForDensity, MAX_COMPLETION_ROWS, promptAreaRows } from "../../src/layout/density.js";

describe("density tiers", () => {
  it("maps widths to the frozen tiers", () => {
    expect(densityForWidth(220)).toBe("high");
    expect(densityForWidth(160)).toBe("high");
    expect(densityForWidth(159)).toBe("normal");
    expect(densityForWidth(120)).toBe("normal");
    expect(densityForWidth(119)).toBe("compact");
    expect(densityForWidth(90)).toBe("compact");
    expect(densityForWidth(89)).toBe("minimal");
    expect(densityForWidth(40)).toBe("minimal");
  });

  it("maps density to widget detail levels", () => {
    expect(detailForDensity("high")).toBe("full");
    expect(detailForDensity("normal")).toBe("expanded");
    expect(detailForDensity("compact")).toBe("normal");
    expect(detailForDensity("minimal")).toBe("compact");
  });

  it("gives the active view all rows minus the fixed chrome (6 rows: header, 2 dividers, activity strip, prompt, context strip)", () => {
    expect(activeViewRows(24)).toBe(18);
    expect(activeViewRows(30)).toBe(24);
    expect(activeViewRows(5)).toBe(3); // never less than 3
  });

  it("shrinks by one more row when the prompt bar is showing its multiline indicator", () => {
    expect(activeViewRows(24, 2)).toBe(17);
    expect(activeViewRows(30, 1)).toBe(24);
  });

  it("shrinks by completion rows when the CompletionSurface is visible", () => {
    // 3 completion rows + 1 prompt row = 4 total prompt area rows
    expect(activeViewRows(30, 4)).toBe(21); // 30 - 6 - 3 = 21
    // Full MAX_COMPLETION_ROWS (6) + 1 prompt row = 7
    expect(activeViewRows(30, 7)).toBe(18); // 30 - 6 - 6 = 18
    // Never less than 3
    expect(activeViewRows(10, 7)).toBe(3);
  });
});

describe("MAX_COMPLETION_ROWS", () => {
  it("is defined as 6", () => {
    expect(MAX_COMPLETION_ROWS).toBe(6);
  });
});

describe("promptAreaRows", () => {
  it("returns promptBarHeight when no completions", () => {
    expect(promptAreaRows(1, 0)).toBe(1);
    expect(promptAreaRows(2, 0)).toBe(2);
  });

  it("adds completion rows up to MAX_COMPLETION_ROWS", () => {
    expect(promptAreaRows(1, 3)).toBe(4); // 1 + 3
    expect(promptAreaRows(1, 6)).toBe(7); // 1 + 6
    expect(promptAreaRows(1, 20)).toBe(7); // 1 + 6 (capped at MAX_COMPLETION_ROWS)
  });

  it("combines with multiline prompt height", () => {
    expect(promptAreaRows(2, 4)).toBe(6); // 2 + 4
    expect(promptAreaRows(2, 20)).toBe(8); // 2 + 6 (capped)
  });
});

