import type { TablePosition } from '@repoerd/model'
import { and, eq, sql } from 'drizzle-orm'
import type { LayoutRepository, LayoutScope } from '../../application/ports/layout-repository.js'
import type { KnownRepo } from '../../domain/repo.js'
import type { AppDatabase } from './database.js'
import { chunk, repoKey } from './keys.js'
import { layouts } from './schema.js'

export class SqliteLayoutRepository implements LayoutRepository {
  constructor(private readonly db: AppDatabase) {}

  async get(scope: LayoutScope): Promise<TablePosition[]> {
    return this.db
      .select({ table: layouts.tableName, x: layouts.x, y: layouts.y })
      .from(layouts)
      .where(this.where(scope))
      .all()
  }

  async upsert(scope: LayoutScope, positions: TablePosition[]) {
    if (positions.length === 0) return
    this.db.transaction((tx) => {
      for (const rows of chunk(this.rows(scope, positions))) {
        tx.insert(layouts)
          .values(rows)
          .onConflictDoUpdate({
            target: [
              layouts.userId,
              layouts.repo,
              layouts.sourceId,
              layouts.mode,
              layouts.tableName,
            ],
            set: { x: sql`excluded.x`, y: sql`excluded.y`, updatedAt: sql`excluded.updated_at` },
          })
          .run()
      }
    })
  }

  async listScopes(userId: string, repo: KnownRepo) {
    return this.db
      .selectDistinct({ sourceId: layouts.sourceId, mode: layouts.mode })
      .from(layouts)
      .where(and(eq(layouts.userId, userId), eq(layouts.repo, repoKey(repo))))
      .all()
  }

  private where(scope: LayoutScope) {
    return and(
      eq(layouts.userId, scope.userId),
      eq(layouts.repo, repoKey(scope.repo)),
      eq(layouts.sourceId, scope.sourceId),
      eq(layouts.mode, scope.mode),
    )
  }

  private rows(scope: LayoutScope, positions: TablePosition[]) {
    const updatedAt = new Date()
    return positions.map((p) => ({
      userId: scope.userId,
      repo: repoKey(scope.repo),
      sourceId: scope.sourceId,
      mode: scope.mode,
      tableName: p.table,
      x: p.x,
      y: p.y,
      updatedAt,
    }))
  }
}
