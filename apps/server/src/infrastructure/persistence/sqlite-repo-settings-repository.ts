import type { ManualSource } from '@repoerd/model'
import { eq } from 'drizzle-orm'
import type { RepoSettingsRepository } from '../../application/ports/repo-settings.js'
import type { KnownRepo } from '../../domain/repo.js'
import type { AppDatabase } from './database.js'
import { repoKey } from './keys.js'
import { repoSettings } from './schema.js'

export class SqliteRepoSettingsRepository implements RepoSettingsRepository {
  constructor(private readonly db: AppDatabase) {}

  async get(repo: KnownRepo): Promise<ManualSource[]> {
    const row = this.db
      .select({ sources: repoSettings.sources })
      .from(repoSettings)
      .where(eq(repoSettings.repo, repoKey(repo)))
      .get()
    return row?.sources ?? []
  }

  async save(repo: KnownRepo, sources: ManualSource[], updatedBy: string) {
    if (sources.length === 0) {
      this.db
        .delete(repoSettings)
        .where(eq(repoSettings.repo, repoKey(repo)))
        .run()
      return
    }
    const values = { repo: repoKey(repo), sources, updatedAt: new Date(), updatedBy }
    this.db
      .insert(repoSettings)
      .values(values)
      .onConflictDoUpdate({ target: repoSettings.repo, set: values })
      .run()
  }
}
