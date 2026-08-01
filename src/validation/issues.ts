import type { StrictValidationResult, ValidationIssue } from "./types.js";

export function issue(code: string, message: string, path?: string): ValidationIssue {
  return { code, message, path };
}

export function rejected<T = never>(issues: ValidationIssue[]): StrictValidationResult<T> {
  return { ok: false, rejected: true, issues };
}

export function accepted<T>(value: T, issues: ValidationIssue[] = []): StrictValidationResult<T> {
  return { ok: issues.length === 0, rejected: false, value, issues };
}

export function issuesToErrors(issues: ValidationIssue[]): string[] {
  return issues.map((i) => (i.path ? `${i.code}: ${i.message} (${i.path})` : `${i.code}: ${i.message}`));
}
