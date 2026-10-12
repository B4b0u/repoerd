import type { DetectedSource, ManualSource, ReadFiles, SchemaFailure } from '@repoerd/model'
import type { SchemaOutcome, SourceSummary } from '../../domain/branch-schema.js'
import type { KnownRepo } from '../../domain/repo.js'
import type { GitHost } from '../ports/git-host.js'
import type { SchemaCache } from '../ports/schema-cache.js'
import type { SchemaToolkit } from '../ports/schema-toolkit.js'
import type { BlobReader } from './blob-reader.js'

export interface CommitSchemaDeps {
  gitHost: GitHost
  toolkit: SchemaToolkit
  schemaCache: SchemaCache
  readBlobs: BlobReader
  /** Clock for failure expiry; defaults to `Date.now`. */
  now?: () => number
}

/**
 * Detection and parsing of one commit. One instance is shared by every use case (main.ts), so
 * concurrent requests for the same commit and source share one parse, whichever route asked.
 */
export interface CommitSchemas {
  detect(
    repo: KnownRepo,
    commitSha: string,
    manual: ManualSource[],
  ): Promise<{ detected: DetectedSource[]; truncated: boolean }>
  outcomeFor(repo: KnownRepo, commitSha: string, selected: DetectedSource): Promise<SchemaOutcome>
}

export const toSourceSummary = (detected: DetectedSource): SourceSummary => ({
  id: detected.source.id,
  name: detected.source.name,
  format: detected.source.format,
  problem: detected.problem,
})

/** How long a detection the parser stopped on (`file-too-complex`) is kept in memory. */
const STOPPED_DETECTION_TTL_MS = 10 * 60_000

/** How long a parse outcome that is not a schema is remembered, by kind. */
const FAILURE_TTL_MS: Partial<Record<SchemaFailure['kind'], number>> = {
  'parse-error': 10 * 60_000,
  'parse-timeout': 60_000,
  'no-tables-found': 10 * 60_000,
}

const outcomeKey = (repo: KnownRepo, commitSha: string, selected: DetectedSource) =>
  [
    String(repo.id),
    commitSha,
    selected.source.id,
    selected.source.format,
    ...selected.files.map((file) => `${file.path}@${file.sha}`),
  ].join('\n')

export function makeCommitSchemas(deps: CommitSchemaDeps): CommitSchemas {
  const now = deps.now ?? Date.now
  // Concurrent requests for the same key share one parse; parse failures are remembered briefly.
  const running = new Map<string, Promise<SchemaOutcome>>()
  const failed = new Map<string, { outcome: SchemaOutcome; expiresAt: number }>()
  // Detections with a `file-too-complex` source may come from a parser crash or timeout, which
  // are transient: never persisted (30 days), only remembered here for a few minutes.
  const stopped = new Map<
    string,
    { result: { detected: DetectedSource[]; truncated: boolean }; expiresAt: number }
  >()

  async function detect(
    repo: KnownRepo,
    commitSha: string,
    manual: ManualSource[],
  ): Promise<{ detected: DetectedSource[]; truncated: boolean }> {
    const cached = await deps.schemaCache.getDetection(repo, commitSha, manual)
    // Only complete trees are ever saved, so a cached detection is never truncated.
    if (cached) return { detected: cached, truncated: false }
    const stoppedKey = JSON.stringify([repo.id, commitSha, manual])
    const remembered = stopped.get(stoppedKey)
    if (remembered && remembered.expiresAt > now()) return remembered.result

    const { entries: tree, truncated } = await deps.gitHost.getTree(repo, commitSha)
    const byPath = new Map(tree.map((entry) => [entry.path, entry]))
    const readFiles: ReadFiles = (paths) =>
      deps.readBlobs(
        repo,
        paths.flatMap((path) => {
          const entry = byPath.get(path)
          return entry ? [entry] : []
        }),
      )
    // Declared sources replace automatic detection entirely (spec §5.4).
    const detected =
      manual.length > 0
        ? await deps.toolkit.resolveManualSources(tree, readFiles, manual)
        : await deps.toolkit.detectSources(tree, readFiles)
    // A truncated listing may hide sources: do not remember it, so a later request re-reads the tree.
    if (detected.some((entry) => entry.problem?.kind === 'file-too-complex')) {
      for (const [k, entry] of stopped) if (entry.expiresAt <= now()) stopped.delete(k)
      stopped.set(stoppedKey, {
        result: { detected, truncated },
        expiresAt: now() + STOPPED_DETECTION_TTL_MS,
      })
    } else if (!truncated) {
      await deps.schemaCache.saveDetection(repo, commitSha, manual, detected)
    }
    return { detected, truncated }
  }

  async function computeOutcome(
    repo: KnownRepo,
    commitSha: string,
    selected: DetectedSource,
  ): Promise<SchemaOutcome> {
    const cached = await deps.schemaCache.getSchema(repo, commitSha, selected)
    if (cached) return { ok: true, schema: cached }

    const contents = await deps.readBlobs(repo, selected.files)
    const files = selected.files.map((entry) => ({
      path: entry.path,
      content: contents.get(entry.path) ?? '',
    }))
    const parsed = await deps.toolkit.parse(files, selected.source.format, {
      casing: selected.casing,
      unresolvedImports: selected.unresolvedImports,
    })
    if (!parsed.ok) return { ok: false, failure: parsed.failure }

    await deps.schemaCache.saveSchema(repo, commitSha, selected, parsed.schema)
    return { ok: true, schema: parsed.schema }
  }

  async function outcomeFor(
    repo: KnownRepo,
    commitSha: string,
    selected: DetectedSource,
  ): Promise<SchemaOutcome> {
    if (selected.problem) return { ok: false, failure: selected.problem }
    const key = outcomeKey(repo, commitSha, selected)
    const remembered = failed.get(key)
    if (remembered && remembered.expiresAt > now()) return remembered.outcome
    const inFlight = running.get(key)
    if (inFlight) return inFlight
    const promise = computeOutcome(repo, commitSha, selected)
      .then((outcome) => {
        const ttl = outcome.ok ? undefined : FAILURE_TTL_MS[outcome.failure.kind]
        if (ttl !== undefined) {
          for (const [k, entry] of failed) if (entry.expiresAt <= now()) failed.delete(k)
          failed.set(key, { outcome, expiresAt: now() + ttl })
        }
        return outcome
      })
      .finally(() => running.delete(key))
    running.set(key, promise)
    return promise
  }

  return { detect, outcomeFor }
}
