import { and, count, eq, gt, lte, or } from 'drizzle-orm'
import type {
  SessionRepository,
  StoredSession,
} from '../../application/ports/session-repository.js'
import { SESSION_MAX_AGE_MS } from '../../domain/session.js'
import type { AppDatabase } from './database.js'
import { sessions } from './schema.js'

export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly db: AppDatabase) {}

  async create(session: StoredSession) {
    this.db.insert(sessions).values(session).run()
  }

  async find(idHash: string): Promise<StoredSession | null> {
    const row = this.db.select().from(sessions).where(eq(sessions.idHash, idHash)).get()
    return row
      ? {
          idHash: row.idHash,
          userId: row.userId,
          expiresAt: row.expiresAt,
          lastSeenAt: row.lastSeenAt,
          createdAt: row.createdAt,
        }
      : null
  }

  async touch(idHash: string, lastSeenAt: Date, expiresAt: Date) {
    this.db.update(sessions).set({ lastSeenAt, expiresAt }).where(eq(sessions.idHash, idHash)).run()
  }

  async delete(idHash: string) {
    this.db.delete(sessions).where(eq(sessions.idHash, idHash)).run()
  }

  async deleteExpired(now: Date) {
    return this.db
      .delete(sessions)
      .where(
        or(
          lte(sessions.expiresAt, now),
          lte(sessions.createdAt, new Date(now.getTime() - SESSION_MAX_AGE_MS)),
        ),
      )
      .run().changes
  }

  async deleteForUser(userId: string) {
    return this.db.delete(sessions).where(eq(sessions.userId, userId)).run().changes
  }

  async deleteAll() {
    return this.db.delete(sessions).run().changes
  }

  async countActiveByUser(now: Date) {
    const rows = this.db
      .select({ userId: sessions.userId, active: count() })
      .from(sessions)
      .where(
        and(
          gt(sessions.expiresAt, now),
          gt(sessions.createdAt, new Date(now.getTime() - SESSION_MAX_AGE_MS)),
        ),
      )
      .groupBy(sessions.userId)
      .all()
    return new Map(rows.map((row) => [row.userId, row.active]))
  }
}
