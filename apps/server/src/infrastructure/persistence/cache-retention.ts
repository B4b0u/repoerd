import type { SqliteBlobCache } from './sqlite-blob-cache.js'
import type { SqliteSchemaCache } from './sqlite-schema-cache.js'

/** Cached file contents, detections and schemas are kept 30 days (README, "Backups and upgrades"). */
export const CACHE_RETENTION_MS = 30 * 24 * 60 * 60_000

/**
 * Deletes the cached rows older than the retention, and those of another cache version. Run at
 * start-up and every day; returns how many rows were deleted.
 */
export function purgeCaches(
  caches: { schemas: SqliteSchemaCache; blobs: SqliteBlobCache },
  now: Date,
): number {
  const before = new Date(now.getTime() - CACHE_RETENTION_MS)
  return (
    caches.schemas.deleteOtherVersions() +
    caches.schemas.deleteOlderThan(before) +
    caches.blobs.deleteOlderThan(before)
  )
}
