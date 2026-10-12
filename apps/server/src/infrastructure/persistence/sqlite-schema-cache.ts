import { createHash } from 'node:crypto'
import type { DbSchema, DetectedSource, ManualSource } from '@repoerd/model'
import { CACHE_VERSION } from '@repoerd/schema-core'
import { and, eq, lt, ne } from 'drizzle-orm'
import type { SchemaCache } from '../../application/ports/schema-cache.js'
import type { KnownRepo } from '../../domain/repo.js'
import type { AppDatabase } from './database.js'
import { repoKey } from './keys.js'
import { schemaCache, schemaDetectionCache } from './schema.js'

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

/** 'auto' for automatic detection, else a hash of the manual sources. */
export const settingsKey = (manual: readonly ManualSource[]) =>
  manual.length === 0 ? 'auto' : sha256(JSON.stringify(manual))

/** Hash of the format and of every path:blobSha: what the parser actually reads. */
export const filesKey = (source: DetectedSource) =>
  sha256(
    JSON.stringify([source.source.format, source.files.map((file) => `${file.path}:${file.sha}`)]),
  )

/** Rows are keyed by CACHE_VERSION too: an upgrade never serves what an older parser produced. */
export class SqliteSchemaCache implements SchemaCache {
  constructor(
    private readonly db: AppDatabase,
    /** Tests only (default: CACHE_VERSION of @repoerd/schema-core). */
    private readonly version: number = CACHE_VERSION,
  ) {}

  async getDetection(repo: KnownRepo, commitSha: string, manual: readonly ManualSource[]) {
    const row = this.db
      .select({ sources: schemaDetectionCache.sources })
      .from(schemaDetectionCache)
      .where(
        and(
          eq(schemaDetectionCache.repo, repoKey(repo)),
          eq(schemaDetectionCache.commitSha, commitSha),
          eq(schemaDetectionCache.settingsKey, settingsKey(manual)),
          eq(schemaDetectionCache.cacheVersion, this.version),
        ),
      )
      .get()
    return row?.sources ?? null
  }

  async saveDetection(
    repo: KnownRepo,
    commitSha: string,
    manual: readonly ManualSource[],
    sources: DetectedSource[],
  ) {
    this.db
      .insert(schemaDetectionCache)
      .values({
        repo: repoKey(repo),
        commitSha,
        settingsKey: settingsKey(manual),
        cacheVersion: this.version,
        sources,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .run()
  }

  async getSchema(
    repo: KnownRepo,
    commitSha: string,
    source: DetectedSource,
  ): Promise<DbSchema | null> {
    const row = this.db
      .select({ schema: schemaCache.schema })
      .from(schemaCache)
      .where(
        and(
          eq(schemaCache.repo, repoKey(repo)),
          eq(schemaCache.commitSha, commitSha),
          eq(schemaCache.sourceId, source.source.id),
          eq(schemaCache.filesKey, filesKey(source)),
          eq(schemaCache.cacheVersion, this.version),
        ),
      )
      .get()
    return row?.schema ?? null
  }

  async saveSchema(repo: KnownRepo, commitSha: string, source: DetectedSource, schema: DbSchema) {
    this.db
      .insert(schemaCache)
      .values({
        repo: repoKey(repo),
        commitSha,
        sourceId: source.source.id,
        filesKey: filesKey(source),
        cacheVersion: this.version,
        schema,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .run()
  }

  /** Deletes the detections and schemas of another cache version; returns how many rows. */
  deleteOtherVersions(): number {
    const detections = this.db
      .delete(schemaDetectionCache)
      .where(ne(schemaDetectionCache.cacheVersion, this.version))
      .run().changes
    const schemas = this.db
      .delete(schemaCache)
      .where(ne(schemaCache.cacheVersion, this.version))
      .run().changes
    return detections + schemas
  }

  /** Deletes the detections and schemas cached before `date`; returns how many rows. */
  deleteOlderThan(date: Date): number {
    const detections = this.db
      .delete(schemaDetectionCache)
      .where(lt(schemaDetectionCache.createdAt, date))
      .run().changes
    const schemas = this.db.delete(schemaCache).where(lt(schemaCache.createdAt, date)).run().changes
    return detections + schemas
  }
}
