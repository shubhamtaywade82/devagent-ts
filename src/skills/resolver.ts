/**
 * Deterministic keyword/tag overlap scoring — no ML/embeddings. Tag hits
 * are weighted higher than description-word hits. Ties are broken by
 * skill id so resolution is reproducible.
 */

import { SkillMeta, SkillScore } from "./types";

const TAG_WEIGHT = 3;
const DESCRIPTION_WEIGHT = 1;

export interface ResolveOptions {
  topN?: number;
  minScore?: number;
}

/** Lowercase, word-boundary tokenization with de-duplication. */
export function tokenize(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(words);
}

function scoreSkill(promptTokens: Set<string>, skill: SkillMeta): SkillScore {
  let score = 0;
  const matchedTags: string[] = [];

  for (const tag of skill.tags) {
    const tagTokens = tokenize(tag);
    if ([...tagTokens].some((t) => promptTokens.has(t))) {
      score += TAG_WEIGHT;
      matchedTags.push(tag);
    }
  }

  const descriptionTokens = tokenize(`${skill.name} ${skill.description}`);
  for (const token of descriptionTokens) {
    if (promptTokens.has(token)) score += DESCRIPTION_WEIGHT;
  }

  return { meta: skill, score, matchedTags };
}

export function resolveSkills(prompt: string, catalog: SkillMeta[], opts: ResolveOptions = {}): SkillScore[] {
  const topN = opts.topN ?? 3;
  const minScore = opts.minScore ?? 1;
  const promptTokens = tokenize(prompt);

  return catalog
    .map((skill) => scoreSkill(promptTokens, skill))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score || a.meta.id.localeCompare(b.meta.id))
    .slice(0, topN);
}
