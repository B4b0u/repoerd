const MAX_PATTERN_LENGTH = 200
const MAX_STARS = 8
const MAX_STAR_RUNS_PER_SEGMENT = 2
/** Same cap as the manual sources (repoSettingsBodySchema); applies to a drizzle.config `schema` array. */
export const MAX_CONFIG_PATTERNS = 50
/** Brace groups, extglob openers and leading negations: not supported, flagged rather than matched wrongly. */
const UNSUPPORTED_SYNTAX = /\{[^}]*\}|[?*+@!]\(|^!/

/** Runs of consecutive `*` in a path segment; a segment that is exactly `**` is free. */
function starRuns(segment: string): number {
  return segment === '**' ? 0 : (segment.match(/\*+/g)?.length ?? 0)
}

/**
 * The first pattern too costly to match safely. Crafted globs can freeze the main thread:
 * matching time grows like n^k with k the star runs of one segment, hence the per-segment cap.
 * Unsupported syntaxes (braces, extended globs, negations) are flagged too: matched literally
 * they would silently find nothing.
 */
export function unsafePattern(patterns: readonly string[]): string | undefined {
  return patterns.find(
    (pattern) =>
      pattern.length > MAX_PATTERN_LENGTH ||
      UNSUPPORTED_SYNTAX.test(pattern) ||
      (pattern.match(/\*/g)?.length ?? 0) > MAX_STARS ||
      pattern.split('/').some((segment) => starRuns(segment) > MAX_STAR_RUNS_PER_SEGMENT),
  )
}
