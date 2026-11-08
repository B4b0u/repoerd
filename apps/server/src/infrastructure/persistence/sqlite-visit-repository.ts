import { and, desc, eq, notInArray } from 'drizzle-orm'
import { MAX_VISITS, type VisitRepository } from '../../application/ports/repo-picker.js'
import type { KnownRepo } from '../../domain/repo.js'
import type { AppDatabase } from './database.js'
import { repoKey } from './keys.js'
import { userRepoVisits } from './schema.js'

export class SqliteVisitRepository implements VisitRepository {
  constructor(private readonly db: AppDatabase) {}

  async record(userId: string, repo: KnownRepo, at: Date): Promise<void> {
    this.db.transaction((tx) => {
      tx.insert(userRepoVisits)
        .values({ userId, repo: repoKey(repo), visitedAt: at })
        .onConflictDoUpdate({
          target: [userRepoVisits.userId, userRepoVisits.repo],
          set: { visitedAt: at },
        })
        .run()
      const kept = tx
        .select({ repo: userRepoVisits.repo })
        .from(userRepoVisits)
        .where(eq(userRepoVisits.userId, userId))
        .orderBy(desc(userRepoVisits.visitedAt), desc(userRepoVisits.repo))
        .limit(MAX_VISITS)
        .all()
        .map((row) => row.repo)
      tx.delete(userRepoVisits)
        .where(and(eq(userRepoVisits.userId, userId), notInArray(userRepoVisits.repo, kept)))
        .run()
    })
  }

  async list(userId: string): Promise<Map<string, Date>> {
    const rows = this.db
      .select()
      .from(userRepoVisits)
      .where(eq(userRepoVisits.userId, userId))
      .all()
    return new Map(rows.map((row) => [row.repo, row.visitedAt]))
  }
}
