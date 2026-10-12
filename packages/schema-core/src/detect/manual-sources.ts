import {
  type DetectedSource,
  type ManualSource,
  manualSourceId,
  type ReadFiles,
  type TreeEntry,
} from '@repoerd/model'
import { defaultParserPool, type SourceAnalyzer } from '../isolate/parser-pool.js'
import {
  byPath,
  DEFAULT_LIMITS,
  type DetectionLimits,
  followDrizzleImports,
  limitProblem,
  matchSchemaPaths,
  type TreeIndex,
  withoutEmpty,
} from './detect-sources.js'
import { createImportResolver } from './import-resolver.js'
import { CODE_FILE, IGNORED_PATH, PRISMA_FILE } from './paths.js'
import { unsafePattern } from './safe-patterns.js'

/**
 * The sources declared in the repository settings (spec §5.4), in their declared order.
 * Paths are relative to the repository root; Drizzle sources follow relative imports.
 */
export async function resolveManualSources(
  tree: TreeEntry[],
  readFiles: ReadFiles,
  sources: readonly ManualSource[],
  limits: DetectionLimits = DEFAULT_LIMITS,
  analyzer: SourceAnalyzer = defaultParserPool(),
): Promise<DetectedSource[]> {
  const entries = tree.filter((entry) => !IGNORED_PATH.test(entry.path))
  const index: TreeIndex = new Map(entries.map((entry) => [entry.path, entry]))
  const resolved: DetectedSource[] = []
  // One resolver for every source: tsconfig and package.json files are read once.
  const resolver = createImportResolver(index, readFiles)
  for (const manual of sources) {
    const source = {
      id: manualSourceId(manual.name),
      name: manual.name,
      format: manual.format,
      origin: 'manual' as const,
    }
    const unsafe = unsafePattern(manual.paths)
    if (unsafe !== undefined) {
      resolved.push({ source, files: [], problem: { kind: 'unsafe-pattern', pattern: unsafe } })
      continue
    }
    const wanted = manual.format === 'prisma' ? PRISMA_FILE : CODE_FILE
    const matched = matchSchemaPaths(entries, index, '', manual.paths, wanted)
    if (matched.length === 0) {
      resolved.push({ source, files: [], problem: { kind: 'source-empty' } })
      continue
    }
    const early = limitProblem(matched, limits)
    const followed =
      early || manual.format === 'prisma'
        ? { files: matched, problem: null, unresolvedImports: [] }
        : await followDrizzleImports(matched, index, readFiles, limits, analyzer, resolver)
    const problem = early ?? followed.problem ?? limitProblem(followed.files, limits)
    resolved.push(
      problem
        ? { source, files: [], problem }
        : {
            source,
            files: [...followed.files].sort(byPath),
            problem: null,
            ...withoutEmpty({ unresolvedImports: followed.unresolvedImports }),
          },
    )
  }
  return resolved
}
