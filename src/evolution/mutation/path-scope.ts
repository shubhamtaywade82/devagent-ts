/**
 * Segment-aware path-prefix containment for mutation-scope enforcement.
 *
 * v2.3.1: every layer of the scope pipeline (runtime proposal checks, strategy
 * attribution, executor planned/actual audits) previously used plain
 * `startsWith(prefix)`, which admits sibling directories: allowed prefix
 * `src/evolution` would admit `src/evolution2/foo.ts`. The executor's
 * actual-diff audit was still the backstop, but the invariant is now explicit
 * at every layer instead of relying on the final defense.
 */

/**
 * True when `path` is `prefix` itself or lives strictly underneath it at a
 * path-segment boundary:
 *
 *   allowed: src/evolution
 *     src/evolution/foo.ts  → true
 *     src/evolution         → true (exact)
 *     src/evolution2/x.ts   → false (sibling, not contained)
 *     src/evolutionfoo.ts   → false (file-name overlap, not contained)
 */
export function pathWithinAllowedPrefix(path: string, prefix: string): boolean {
  if (!path || !prefix) return false;
  if (path === prefix) return true;
  const boundary = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return path.startsWith(boundary);
}
