import { inArray, lt } from 'drizzle-orm'
import type { BlobCache } from '../../application/ports/blob-cache.js'
import type { AppDatabase } from './database.js'
import { chunk } from './keys.js'
import { blobCache } from './schema.js'

export class SqliteBlobCache implements BlobCache {
  constructor(private readonly db: AppDatabase) {}

  async getMany(blobShas: string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>()
    for (const shas of chunk(blobShas)) {
      for (const row of this.db
        .select()
        .from(blobCache)
        .where(inArray(blobCache.sha, shas))
        .all()) {
        found.set(row.sha, row.content)
      }
    }
    return found
  }

  async putMany(entries: Map<string, string>) {
    const createdAt = new Date()
    const rows = [...entries].map(([sha, content]) => ({ sha, content, createdAt }))
    this.db.transaction((tx) => {
      for (const part of chunk(rows)) tx.insert(blobCache).values(part).onConflictDoNothing().run()
    })
  }

  /** Deletes the contents cached before `date`; returns how many. */
  deleteOlderThan(date: Date): number {
    return this.db.delete(blobCache).where(lt(blobCache.createdAt, date)).run().changes
  }
}
