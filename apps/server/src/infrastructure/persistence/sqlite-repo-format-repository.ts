import type { RepoSchemaFormat } from '@repoerd/model'
import { eq, inArray } from 'drizzle-orm'
import type { RepoFormatRepository, StoredRepoFormat } from '../../application/ports/repo-picker.js'
import type { KnownRepo } from '../../domain/repo.js'
import type { AppDatabase } from './database.js'
import { chunk, repoKey } from './keys.js'
import { repoFormats } from './schema.js'

export class SqliteRepoFormatRepository implements RepoFormatRepository {
  constructor(private readonly db: AppDatabase) {}

  async getMany(keys: readonly string[]): Promise<Map<string, StoredRepoFormat>> {
    const found = new Map<string, StoredRepoFormat>()
    for (const part of chunk(keys)) {
      const rows = this.db.select().from(repoFormats).where(inArray(repoFormats.repo, part)).all()
      for (const row of rows) {
        if (row.format === null || row.commitSha === null) continue
        found.set(row.repo, {
          format: row.format,
          commitSha: row.commitSha,
          checkedAt: row.checkedAt,
          failedAt: row.failedAt,
          stale: row.stale,
        })
      }
    }
    return found
  }

  async save(
    repo: KnownRepo,
    value: { format: RepoSchemaFormat; commitSha: string; checkedAt: Date },
  ): Promise<void> {
    const row = { ...value, failedAt: null, stale: false }
    this.db
      .insert(repoFormats)
      .values({ repo: repoKey(repo), ...row })
      .onConflictDoUpdate({ target: repoFormats.repo, set: row })
      .run()
  }

  async touch(repo: KnownRepo, checkedAt: Date): Promise<void> {
    this.db
      .update(repoFormats)
      .set({ checkedAt })
      .where(eq(repoFormats.repo, repoKey(repo)))
      .run()
  }

  async markFailed(repo: KnownRepo, at: Date): Promise<void> {
    this.db
      .insert(repoFormats)
      .values({ repo: repoKey(repo), checkedAt: at, failedAt: at })
      .onConflictDoUpdate({ target: repoFormats.repo, set: { failedAt: at } })
      .run()
  }

  async getFailures(keys: readonly string[]): Promise<Map<string, Date>> {
    const failures = new Map<string, Date>()
    for (const part of chunk(keys)) {
      const rows = this.db
        .select({ repo: repoFormats.repo, failedAt: repoFormats.failedAt })
        .from(repoFormats)
        .where(inArray(repoFormats.repo, part))
        .all()
      for (const row of rows) if (row.failedAt) failures.set(row.repo, row.failedAt)
    }
    return failures
  }

  async markStale(repo: KnownRepo): Promise<void> {
    this.db
      .update(repoFormats)
      .set({ stale: true })
      .where(eq(repoFormats.repo, repoKey(repo)))
      .run()
  }
}
