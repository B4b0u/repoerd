import type { DetectedSource } from '@repoerd/model'

/** Folders whose schemas are rarely the one to show first (spec §6.1). */
const SECONDARY_FOLDERS = new Set(['test', 'tests', '__tests__', 'fixtures', 'examples'])

/** An automatically detected source under a test, fixture or example folder (manual ones never are). */
export function isSecondarySource(detected: DetectedSource): boolean {
  return (
    detected.source.origin === 'detected' &&
    detected.source.id.split('/').some((segment) => SECONDARY_FOLDERS.has(segment.toLowerCase()))
  )
}

/**
 * The source shown when none is asked for: the first one without problem outside those folders,
 * else the first one.
 */
export function defaultSource(detected: readonly DetectedSource[]): DetectedSource | undefined {
  return (
    detected.find((entry) => entry.problem === null && !isSecondarySource(entry)) ?? detected[0]
  )
}
