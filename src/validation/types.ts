export type RiskLevel = "low" | "medium" | "high" | "critical";

export type PatchHunk = {
  path: string;
  old_str: string;
  new_str: string;
};

export type ValidationIssue = {
  code: string;
  message: string;
  path?: string;
};

export type StrictValidationResult<T = unknown> = {
  ok: boolean;
  rejected: boolean;
  value?: T;
  issues: ValidationIssue[];
};

export type PatchSafetyContext = {
  goal?: string;
  allowedPathPrefixes?: string[];
  projectRoot?: string;
  maxPatchChars?: number;
  maxPlanChars?: number;
  minRelevance?: number;
};

export const RISK_LEVELS: readonly RiskLevel[] = ["low", "medium", "high", "critical"] as const;
