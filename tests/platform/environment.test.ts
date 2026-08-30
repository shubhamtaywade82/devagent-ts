import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  activeLegacyEnvVariables,
  envIs,
  readEnv,
  readEnvFlag,
  resetDeprecationWarnings,
  suppressDeprecationWarnings,
} from "../../src/platform/environment.js";
import { BRAND } from "../../src/platform/brand.js";

const savedEnv = { ...process.env };

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("platform/environment — NEXUM_* canonical, DEVAGENT_* deprecated fallback", () => {
  beforeEach(() => {
    process.env = { ...savedEnv };
    // scrub any variables the outer harness may have set
    setEnv("NEXUM_MODEL", undefined);
    setEnv("DEVAGENT_MODEL", undefined);
    setEnv("NEXUM_TIER", undefined);
    setEnv("DEVAGENT_TIER", undefined);
    setEnv("NEXUM_NO_DEPRECATION_WARNINGS", undefined);
    resetDeprecationWarnings();
    suppressDeprecationWarnings(false);
  });

  it("reads a canonical NEXUM_* variable", () => {
    setEnv("NEXUM_MODEL", "qwen3.5:8b");
    expect(readEnv("MODEL")).toBe("qwen3.5:8b");
  });

  it("reads a legacy DEVAGENT_* variable as a fallback", () => {
    setEnv("DEVAGENT_MODEL", "qwen3.5:4b");
    expect(readEnv("MODEL")).toBe("qwen3.5:4b");
  });

  it("new env beats legacy env when both are set (documented precedence)", () => {
    setEnv("NEXUM_MODEL", "canonical-model");
    setEnv("DEVAGENT_MODEL", "legacy-model");
    expect(readEnv("MODEL")).toBe("canonical-model");
  });

  it("canonical wins even when set to the empty string (?? semantics)", () => {
    setEnv("NEXUM_MODEL", "");
    setEnv("DEVAGENT_MODEL", "legacy-model");
    expect(readEnv("MODEL")).toBe("");
  });

  it("returns undefined when neither form is set", () => {
    expect(readEnv("MODEL")).toBeUndefined();
  });

  it("warns on stderr exactly once per legacy variable", () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    setEnv("DEVAGENT_MODEL", "legacy");
    readEnv("MODEL");
    readEnv("MODEL");
    readEnv("MODEL");
    expect(err).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledWith(`DEVAGENT_MODEL is deprecated. Use NEXUM_MODEL instead.`);
    err.mockRestore();
  });

  it("does not warn when only the canonical variable is read", () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    setEnv("NEXUM_MODEL", "canonical");
    readEnv("MODEL");
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("suppressDeprecationWarnings silences the warning programmatically", () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    suppressDeprecationWarnings(true);
    setEnv("DEVAGENT_MODEL", "legacy");
    expect(readEnv("MODEL")).toBe("legacy");
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("NEXUM_NO_DEPRECATION_WARNINGS=1 silences the warning via env", () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    setEnv("NEXUM_NO_DEPRECATION_WARNINGS", "1");
    setEnv("DEVAGENT_MODEL", "legacy");
    expect(readEnv("MODEL")).toBe("legacy");
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("readEnvFlag parses booleans in both directions with legacy fallback", () => {
    expect(readEnvFlag("TIER", true)).toBe(true); // unset -> fallback
    setEnv("DEVAGENT_VERIFIER", "false");
    expect(readEnvFlag("VERIFIER", true)).toBe(false);
    setEnv("NEXUM_VERIFIER", "1");
    expect(readEnvFlag("VERIFIER", false)).toBe(true); // canonical beats legacy
    setEnv("NEXUM_VERIFIER", "0");
    expect(readEnvFlag("VERIFIER", true)).toBe(false);
  });

  it("envIs matches either form", () => {
    setEnv("DEVAGENT_TEST_NO_GLOBAL", "true");
    expect(envIs("TEST_NO_GLOBAL", "true")).toBe(true);
    setEnv("NEXUM_TEST_NO_GLOBAL", "true");
    expect(envIs("TEST_NO_GLOBAL", "true")).toBe(true);
  });

  it("budgetFromEnv prefers NEXUM_TOKEN_BUDGET over DEVAGENT_TOKEN_BUDGET", async () => {
    const { budgetFromEnv } = await import("../../src/observability/budget.js");
    expect(budgetFromEnv({ NEXUM_TOKEN_BUDGET: "100", DEVAGENT_TOKEN_BUDGET: "5" } as NodeJS.ProcessEnv).limit).toBe(
      100,
    );
    expect(budgetFromEnv({ DEVAGENT_TOKEN_BUDGET: "5" } as NodeJS.ProcessEnv).limit).toBe(5);
    expect(budgetFromEnv({} as NodeJS.ProcessEnv).limit).toBe(0);
  });

  it("activeLegacyEnvVariables lists set DEVAGENT_* names for migration reports", () => {
    setEnv("DEVAGENT_MODEL", "x");
    setEnv("DEVAGENT_TIER", "local");
    const names = activeLegacyEnvVariables();
    expect(names).toContain("DEVAGENT_MODEL");
    expect(names).toContain("DEVAGENT_TIER");
    expect(names.every((n) => n.startsWith(BRAND.legacyEnvPrefix))).toBe(true);
  });
});
