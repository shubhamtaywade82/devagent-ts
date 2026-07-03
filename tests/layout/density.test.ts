import { activeViewRows, densityForWidth, detailForDensity } from "../../src/layout/density";

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

  it("gives the active view all rows minus the four fixed zones", () => {
    expect(activeViewRows(24)).toBe(20);
    expect(activeViewRows(30)).toBe(26);
    expect(activeViewRows(5)).toBe(3); // never less than 3
  });
});
