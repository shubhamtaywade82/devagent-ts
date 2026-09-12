/**
 * Argument validation + canonicalization (review item 6).
 *
 * Pipeline position (between normalization and policy):
 *
 *   decode (JSON parse/repair)
 *     → normalize (positional/numeric-key mapping)
 *     → VALIDATE (this module)
 *     → canonical args
 *     → policy
 *     → execution
 *
 * The core plane deliberately stays zod-free (dependency-light), so this
 * validator enforces the JSON-Schema subset tools actually declare:
 * required, types (string/number/integer/boolean/array/object/null),
 * enum/const, string min/max length + pattern, number min/max, array
 * items + minItems/maxItems, object additionalProperties:false.
 *
 * State-changing tools (filesystem/process/external/financial side
 * effects) get STRICT validation by default: unknown properties are
 * rejected, not silently dropped. Read-only tools get lenient validation
 * (unknown keys pruned with a note) so weak models keep working.
 */

import type { ToolDefinition } from "../../core/tools/tool-contract.js";

export interface ValidationOptions {
  /** Strict: unknown properties are errors. Lenient: they are pruned. */
  mode?: "strict" | "lenient";
}

export interface ValidationResult {
  ok: boolean;
  /** Canonical args: validated, defaulted, pruned, key-ordered. */
  args: Record<string, unknown>;
  problems: string[];
  /** Non-fatal notes (pruned keys, coerced values) for observability. */
  notes: string[];
}

type JsonSchema = Record<string, any>;

export function validateAndCanonicalizeArgs(
  definition: ToolDefinition | undefined,
  args: Record<string, unknown>,
  opts: ValidationOptions = {},
): ValidationResult {
  const problems: string[] = [];
  const notes: string[] = [];
  if (!definition) {
    return { ok: true, args, problems, notes };
  }
  const schema: JsonSchema = definition.inputSchema ?? {};
  const properties: Record<string, JsonSchema> = schema.properties ?? {};
  const required: string[] = Array.isArray(schema.required) ? schema.required : [];

  // state-changing tools are strict by default (review item 6)
  const strictDefault = toolRequiresStrictValidation(definition);
  const mode = opts.mode ?? (strictDefault ? "strict" : "lenient");

  // 1. required keys
  for (const key of required) {
    if (!(key in args) || args[key] === undefined) {
      problems.push(`missing required argument "${key}"`);
    }
  }

  // 2. per-property validation + canonicalization
  const canonical: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    const propSchema = properties[key];
    if (value === undefined) continue; // treat undefined as absent
    if (!propSchema) {
      if (mode === "strict") {
        problems.push(`unknown argument "${key}" (strict mode; schema has no such property)`);
      } else {
        notes.push(`pruned unknown argument "${key}"`);
      }
      continue;
    }
    const checked = validateValue(key, value, propSchema, notes);
    if (checked.problem) problems.push(checked.problem);
    else if (checked.value !== undefined) canonical[key] = checked.value;
  }

  // 3. defaults (schema-level `default`)
  for (const [key, propSchema] of Object.entries(properties)) {
    if (!(key in canonical) && propSchema && propSchema.default !== undefined && !required.includes(key)) {
      canonical[key] = propSchema.default;
    }
  }

  // 4. key ordering: schema order first, then remaining canonical keys
  const ordered: Record<string, unknown> = {};
  for (const key of [...Object.keys(properties), ...Object.keys(canonical)]) {
    if (key in canonical && !(key in ordered)) ordered[key] = canonical[key];
  }

  return { ok: problems.length === 0, args: ordered, problems, notes };
}

/** Strict-by-default for state-changing tools (review item 6). */
export function toolRequiresStrictValidation(def: ToolDefinition): boolean {
  const se = def.sideEffects;
  return se.filesystem || se.process || se.externalMutation || se.financial || def.risk === "critical";
}

function validateValue(
  key: string,
  value: unknown,
  schema: JsonSchema,
  notes: string[],
): { value?: unknown; problem?: string } {
  const expected = schema.type;
  const typeList = Array.isArray(expected) ? expected : expected ? [expected] : [];
  let v = value;

  // last-chance deterministic coercion: numeric strings for number fields
  // (normalization happened BEFORE validation — this is the repair the
  // review's pipeline still tolerates, and it is logged).
  for (const t of typeList) {
    if (t === "string" && typeof v === "string") break;
    if (t === "number" && typeof v === "number") break;
    if (t === "number" && typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
      notes.push(`coerced "${key}" string to number`);
      v = Number(v);
      break;
    }
    if (t === "integer" && typeof v === "number" && Number.isInteger(v)) break;
    if (t === "integer" && typeof v === "string" && v.trim() !== "" && Number.isInteger(Number(v))) {
      notes.push(`coerced "${key}" string to integer`);
      v = Number(v);
      break;
    }
    if (t === "boolean" && typeof v === "boolean") break;
    if (t === "array" && Array.isArray(v)) break;
    if (t === "object" && typeof v === "object" && v !== null && !Array.isArray(v)) break;
    if (t === "null" && v === null) break;
  }

  // type mismatch check
  if (typeList.length > 0 && !matchesAnyType(v, typeList)) {
    return { problem: `argument "${key}" expected ${typeList.join("|")}, got ${describeType(v)}` };
  }

  // enum / const
  if (Array.isArray(schema.enum) && !schema.enum.includes(v)) {
    return { problem: `argument "${key}" must be one of: ${schema.enum.map(String).join(", ")}` };
  }
  if (schema.const !== undefined && v !== schema.const) {
    return { problem: `argument "${key}" must equal ${JSON.stringify(schema.const)}` };
  }

  // string constraints
  if (typeof v === "string") {
    if (typeof schema.minLength === "number" && v.length < schema.minLength) {
      return { problem: `argument "${key}" shorter than minLength ${schema.minLength}` };
    }
    if (typeof schema.maxLength === "number" && v.length > schema.maxLength) {
      return { problem: `argument "${key}" longer than maxLength ${schema.maxLength}` };
    }
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern).test(v)) {
          return { problem: `argument "${key}" does not match pattern ${schema.pattern}` };
        }
      } catch {
        notes.push(`invalid pattern on "${key}" ignored`);
      }
    }
  }

  // number constraints
  if (typeof v === "number") {
    if (typeof schema.minimum === "number" && v < schema.minimum) {
      return { problem: `argument "${key}" below minimum ${schema.minimum}` };
    }
    if (typeof schema.maximum === "number" && v > schema.maximum) {
      return { problem: `argument "${key}" above maximum ${schema.maximum}` };
    }
  }

  // array constraints
  if (Array.isArray(v)) {
    if (typeof schema.minItems === "number" && v.length < schema.minItems) {
      return { problem: `argument "${key}" needs at least ${schema.minItems} items` };
    }
    if (typeof schema.maxItems === "number" && v.length > schema.maxItems) {
      return { problem: `argument "${key}" allows at most ${schema.maxItems} items` };
    }
    if (schema.items && typeof schema.items === "object") {
      for (let i = 0; i < v.length; i++) {
        const item = validateValue(`${key}[${i}]`, v[i], schema.items, notes);
        if (item.problem) return { problem: item.problem };
        if (item.value !== undefined) v[i] = item.value;
      }
    }
  }

  // object constraints
  if (typeof v === "object" && v !== null && !Array.isArray(v) && schema.properties) {
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const k of Object.keys(v)) {
        if (!allowed.has(k)) {
          return { problem: `argument "${key}" has unknown property "${k}" (additionalProperties: false)` };
        }
      }
    }
  }

  return { value: v };
}

function matchesAnyType(value: unknown, types: string[]): boolean {
  return types.some((t) => {
    switch (t) {
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number";
      case "integer":
        return typeof value === "number" && Number.isInteger(value);
      case "boolean":
        return typeof value === "boolean";
      case "array":
        return Array.isArray(value);
      case "object":
        return typeof value === "object" && value !== null && !Array.isArray(value);
      case "null":
        return value === null;
      default:
        return true; // unknown type keywords pass through
    }
  });
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
