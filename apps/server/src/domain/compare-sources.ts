import type { DetectedSource } from '@repoerd/model'

/**
 * The source compared on each side: by id; when the id exists on one side only and each side has
 * exactly one source of its format, those two are paired (a schema moved or split elsewhere,
 * spec §6.1) instead of one side reading as an empty schema.
 */
export function pickCompareSources(
  before: readonly DetectedSource[],
  after: readonly DetectedSource[],
  selectedId: string,
): { before?: DetectedSource; after?: DetectedSource } {
  const byId = (detected: readonly DetectedSource[]) =>
    detected.find((entry) => entry.source.id === selectedId)
  const found = { before: byId(before), after: byId(after) }
  const present = found.before ?? found.after
  if (!present || (found.before && found.after)) return found
  const onlyOfFormat = (detected: readonly DetectedSource[]) => {
    const same = detected.filter((entry) => entry.source.format === present.source.format)
    return same.length === 1 ? same[0] : undefined
  }
  const pairedBefore = onlyOfFormat(before)
  const pairedAfter = onlyOfFormat(after)
  return pairedBefore && pairedAfter ? { before: pairedBefore, after: pairedAfter } : found
}
