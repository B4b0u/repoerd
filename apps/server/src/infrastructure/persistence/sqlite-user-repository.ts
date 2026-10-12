import { and, count, desc, eq, isNotNull, ne, notExists, or, sql } from 'drizzle-orm'
import type { SecretBox } from '../../application/ports/secret-box.js'
import type {
  AppUser,
  UserProfile,
  UserRecord,
  UserRepository,
  UserTokens,
} from '../../application/ports/user-repository.js'
import { STALE_LOGIN_SUFFIX } from '../../domain/user-login.js'
import type { AppDatabase } from './database.js'
import { users } from './schema.js'

const toUser = (row: typeof users.$inferSelect): AppUser => ({
  id: row.id,
  login: row.login,
  avatarUrl: row.avatarUrl,
  isAdmin: row.isAdmin,
})

export class SqliteUserRepository implements UserRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly box: SecretBox,
  ) {}

  async upsert(profile: UserProfile) {
    this.db.transaction((tx) => {
      // A GitHub login belongs to one account: release it from any other one (renamed login
      // reused). `~` is not allowed in GitHub logins, so a stale login cannot collide.
      tx.update(users)
        .set({ login: sql`${users.login} || ${STALE_LOGIN_SUFFIX}` })
        .where(
          and(
            sql`lower(${users.login}) = ${profile.login.toLowerCase()}`,
            ne(users.id, profile.id),
          ),
        )
        .run()
      tx.insert(users)
        .values({
          id: profile.id,
          login: profile.login,
          avatarUrl: profile.avatarUrl,
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: users.id,
          set: { login: profile.login, avatarUrl: profile.avatarUrl },
        })
        .run()
    })
  }

  async get(id: string): Promise<AppUser | null> {
    const row = this.db.select().from(users).where(eq(users.id, id)).get()
    return row ? toUser(row) : null
  }

  async setAdmin(id: string, isAdmin: boolean) {
    this.db.update(users).set({ isAdmin }).where(eq(users.id, id)).run()
  }

  async countAdmins(): Promise<number> {
    return (
      this.db.select({ value: count() }).from(users).where(eq(users.isAdmin, true)).get()?.value ??
      0
    )
  }

  async promoteFirstAdmin(id: string): Promise<boolean> {
    // One statement: two concurrent sign-ins cannot both see "no administrator yet".
    const admins = this.db.select({ id: users.id }).from(users).where(eq(users.isAdmin, true))
    const result = this.db
      .update(users)
      .set({ isAdmin: true })
      .where(and(eq(users.id, id), notExists(admins)))
      .run()
    return result.changes === 1
  }

  async getTokens(id: string): Promise<UserTokens | null> {
    const row = this.db.select().from(users).where(eq(users.id, id)).get()
    if (!row?.accessToken) return null
    return {
      accessToken: this.box.open(row.accessToken),
      accessTokenExpiresAt: row.accessTokenExpiresAt,
      refreshToken: row.refreshToken ? this.box.open(row.refreshToken) : null,
      refreshTokenExpiresAt: row.refreshTokenExpiresAt,
    }
  }

  async saveTokens(id: string, tokens: UserTokens | null) {
    this.db
      .update(users)
      .set({
        accessToken: tokens ? this.box.seal(tokens.accessToken) : null,
        accessTokenExpiresAt: tokens?.accessTokenExpiresAt ?? null,
        refreshToken: tokens?.refreshToken ? this.box.seal(tokens.refreshToken) : null,
        refreshTokenExpiresAt: tokens?.refreshTokenExpiresAt ?? null,
      })
      .where(eq(users.id, id))
      .run()
  }

  async listAdmins(): Promise<AppUser[]> {
    return this.db
      .select()
      .from(users)
      .where(eq(users.isAdmin, true))
      .orderBy(sql`lower(${users.login})`)
      .all()
      .map(toUser)
  }

  async findByLogin(login: string): Promise<AppUser | null> {
    // A login belongs to one account (see upsert); the ordering is only a safety net.
    const row = this.db
      .select()
      .from(users)
      .where(sql`lower(${users.login}) = ${login.toLowerCase()}`)
      .orderBy(desc(users.createdAt))
      .get()
    return row ? toUser(row) : null
  }

  async demoteAdmin(id: string): Promise<boolean> {
    // One statement: two concurrent removals cannot both see "another administrator remains".
    const result = this.db
      .update(users)
      .set({ isAdmin: false })
      .where(
        and(
          eq(users.id, id),
          eq(users.isAdmin, true),
          sql`(SELECT count(*) FROM users WHERE is_admin = 1) > 1`,
        ),
      )
      .run()
    return result.changes === 1
  }

  async clearAllTokens(): Promise<number> {
    return this.db
      .update(users)
      .set({
        accessToken: null,
        accessTokenExpiresAt: null,
        refreshToken: null,
        refreshTokenExpiresAt: null,
      })
      .where(or(isNotNull(users.accessToken), isNotNull(users.refreshToken)))
      .run().changes
  }

  async listUsers(): Promise<UserRecord[]> {
    return this.db
      .select()
      .from(users)
      .orderBy(sql`lower(${users.login})`, users.id)
      .all()
      .map((row) => ({ ...toUser(row), lastSeenAt: row.lastSeenAt }))
  }

  async recordActivity(id: string, at: Date) {
    this.db.update(users).set({ lastSeenAt: at }).where(eq(users.id, id)).run()
  }
}
