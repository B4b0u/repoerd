import type { ManualSource } from '@repoerd/model'
import { err, ok, type Result } from './result.js'

export const MAX_MANUAL_SOURCES = 20
export const MAX_SOURCE_NAME = 100
export const MAX_SOURCE_PATHS = 50
export const MAX_SOURCE_PATH = 500

export type ManualSourceRejection =
  | { reason: 'too-many-sources'; max: number }
  | { reason: 'name-missing' }
  | { reason: 'name-control-characters' }
  | { reason: 'name-too-long'; max: number }
  | { reason: 'duplicate-name'; name: string }
  | { reason: 'no-path'; name: string }
  | { reason: 'too-many-paths'; name: string; max: number }
  | { reason: 'path-too-long'; max: number }
  | { reason: 'path-invalid'; name: string; path: string }

export type ManualSourcesError = { kind: 'invalid-sources'; rejection: ManualSourceRejection }

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/

const invalid = (rejection: ManualSourceRejection) =>
  err<ManualSourcesError>({ kind: 'invalid-sources', rejection })

function isSafePath(path: string): boolean {
  if (path.startsWith('/') || path.includes('\\') || CONTROL.test(path)) return false
  return !path.split('/').includes('..')
}

function normalizePaths(paths: readonly string[]): string[] {
  const normalized = paths
    .map((path) => path.trim())
    .map((path) => path.replace(/^(\.\/)+/, ''))
    .filter((path) => path !== '')
  return [...new Set(normalized)]
}

/** Validates and normalises the manual sources of a repository (spec §5.4). Empty = automatic detection. */
export function validateManualSources(
  input: readonly ManualSource[],
): Result<ManualSource[], ManualSourcesError> {
  if (input.length > MAX_MANUAL_SOURCES)
    return invalid({ reason: 'too-many-sources', max: MAX_MANUAL_SOURCES })
  const seen = new Set<string>()
  const sources: ManualSource[] = []
  for (const raw of input) {
    const name = raw.name.trim()
    if (name === '') return invalid({ reason: 'name-missing' })
    if (CONTROL.test(name)) return invalid({ reason: 'name-control-characters' })
    if (name.length > MAX_SOURCE_NAME)
      return invalid({ reason: 'name-too-long', max: MAX_SOURCE_NAME })
    if (seen.has(name.toLowerCase())) return invalid({ reason: 'duplicate-name', name })
    seen.add(name.toLowerCase())

    const paths = normalizePaths(raw.paths)
    if (paths.length === 0) return invalid({ reason: 'no-path', name })
    if (paths.length > MAX_SOURCE_PATHS)
      return invalid({ reason: 'too-many-paths', name, max: MAX_SOURCE_PATHS })
    for (const path of paths) {
      if (path.length > MAX_SOURCE_PATH)
        return invalid({ reason: 'path-too-long', max: MAX_SOURCE_PATH })
      if (!isSafePath(path)) return invalid({ reason: 'path-invalid', name, path })
    }
    sources.push({ name, format: raw.format, paths })
  }
  return ok(sources)
}
