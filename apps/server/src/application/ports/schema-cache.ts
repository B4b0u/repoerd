import type { DbSchema, DetectedSource, ManualSource } from '@repoerd/model'
import type { KnownRepo } from '../../domain/repo.js'

/**
 * Immutable caches keyed by commit SHA. Saving an existing key must be a silent no-op.
 * Keys also cover what may change for a given commit: the manual sources (detection) and the
 * exact files of a source (schema), so a redefined source never reuses an old result.
 */
export interface SchemaCache {
  getDetection(
    repo: KnownRepo,
    commitSha: string,
    manual: readonly ManualSource[],
  ): Promise<DetectedSource[] | null>
  saveDetection(
    repo: KnownRepo,
    commitSha: string,
    manual: readonly ManualSource[],
    sources: DetectedSource[],
  ): Promise<void>
  getSchema(repo: KnownRepo, commitSha: string, source: DetectedSource): Promise<DbSchema | null>
  saveSchema(
    repo: KnownRepo,
    commitSha: string,
    source: DetectedSource,
    schema: DbSchema,
  ): Promise<void>
}
