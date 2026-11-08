import { and, count, eq } from 'drizzle-orm'
import { type FavoriteRepository, MAX_FAVORITES } from '../../application/ports/repo-picker.js'
import type { KnownRepo } from '../../domain/repo.js'
import type { AppDatabase } from './database.js'
import { repoKey } from './keys.js'
import { userFavoriteRepos } from './schema.js'

export class SqliteFavoriteRepository implements FavoriteRepository {
  constructor(private readonly db: AppDatabase) {}

  async list(userId: string): Promise<Set<string>> {
    const rows = this.db
      .select({ repo: userFavoriteRepos.repo })
      .from(userFavoriteRepos)
      .where(eq(userFavoriteRepos.userId, userId))
      .all()
    return new Set(rows.map((row) => row.repo))
  }

  async add(userId: string, repo: KnownRepo, now: Date): Promise<'added' | 'limit'> {
    const key = repoKey(repo)
    return this.db.transaction((tx) => {
      const existing = tx
        .select({ repo: userFavoriteRepos.repo })
        .from(userFavoriteRepos)
        .where(and(eq(userFavoriteRepos.userId, userId), eq(userFavoriteRepos.repo, key)))
        .get()
      if (existing) return 'added' as const
      const total =
        tx
          .select({ n: count() })
          .from(userFavoriteRepos)
          .where(eq(userFavoriteRepos.userId, userId))
          .get()?.n ?? 0
      if (total >= MAX_FAVORITES) return 'limit' as const
      tx.insert(userFavoriteRepos).values({ userId, repo: key, createdAt: now }).run()
      return 'added' as const
    })
  }

  async remove(userId: string, repo: KnownRepo): Promise<void> {
    this.db
      .delete(userFavoriteRepos)
      .where(and(eq(userFavoriteRepos.userId, userId), eq(userFavoriteRepos.repo, repoKey(repo))))
      .run()
  }
}
