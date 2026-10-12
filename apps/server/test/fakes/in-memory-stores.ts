import type { DbSchema, DetectedSource, ManualSource, TablePosition } from '@repoerd/model'
import type { BlobCache } from '../../src/application/ports/blob-cache.js'
import {
  EMPTY_INSTANCE_CONFIG,
  type InstanceConfig,
  type InstanceConfigRepository,
} from '../../src/application/ports/instance-config.js'
import type {
  LayoutRepository,
  LayoutScope,
} from '../../src/application/ports/layout-repository.js'
import type { RepoSettingsRepository } from '../../src/application/ports/repo-settings.js'
import type { SchemaCache } from '../../src/application/ports/schema-cache.js'
import type {
  SessionRepository,
  StoredSession,
} from '../../src/application/ports/session-repository.js'
import type {
  AppUser,
  UserProfile,
  UserRecord,
  UserRepository,
  UserTokens,
} from '../../src/application/ports/user-repository.js'
import type { KnownRepo } from '../../src/domain/repo.js'
import { isPastMaxAge } from '../../src/domain/session.js'
import { STALE_LOGIN_SUFFIX } from '../../src/domain/user-login.js'

const repoKey = (repo: KnownRepo) => String(repo.id)

export class InMemorySchemaCache implements SchemaCache {
  readonly detections = new Map<string, DetectedSource[]>()
  readonly schemas = new Map<string, DbSchema>()

  async getDetection(repo: KnownRepo, commitSha: string, manual: readonly ManualSource[]) {
    return this.detections.get(this.detectionKey(repo, commitSha, manual)) ?? null
  }
  async saveDetection(
    repo: KnownRepo,
    commitSha: string,
    manual: readonly ManualSource[],
    sources: DetectedSource[],
  ) {
    this.detections.set(this.detectionKey(repo, commitSha, manual), sources)
  }
  async getSchema(repo: KnownRepo, commitSha: string, source: DetectedSource) {
    return this.schemas.get(this.schemaKey(repo, commitSha, source)) ?? null
  }
  async saveSchema(repo: KnownRepo, commitSha: string, source: DetectedSource, schema: DbSchema) {
    this.schemas.set(this.schemaKey(repo, commitSha, source), schema)
  }
  private detectionKey(repo: KnownRepo, commitSha: string, manual: readonly ManualSource[]) {
    return `${repoKey(repo)}|${commitSha}|${JSON.stringify(manual)}`
  }
  private schemaKey(repo: KnownRepo, commitSha: string, source: DetectedSource) {
    const files = JSON.stringify([
      source.source.format,
      source.files.map((f) => `${f.path}:${f.sha}`),
    ])
    return `${repoKey(repo)}|${commitSha}|${source.source.id}|${files}`
  }
}

export class InMemoryRepoSettings implements RepoSettingsRepository {
  readonly settings = new Map<string, ManualSource[]>()

  async get(repo: KnownRepo) {
    return this.settings.get(repoKey(repo)) ?? []
  }
  async save(repo: KnownRepo, sources: ManualSource[], _updatedBy: string) {
    if (sources.length === 0) this.settings.delete(repoKey(repo))
    else this.settings.set(repoKey(repo), sources)
  }
}

export class InMemoryBlobCache implements BlobCache {
  readonly entries = new Map<string, string>()

  async getMany(blobShas: string[]) {
    const found = new Map<string, string>()
    for (const sha of blobShas) {
      const content = this.entries.get(sha)
      if (content !== undefined) found.set(sha, content)
    }
    return found
  }
  async putMany(entries: Map<string, string>) {
    for (const [sha, content] of entries) this.entries.set(sha, content)
  }
}

export class InMemoryLayoutRepository implements LayoutRepository {
  /** Keyed by the JSON of the scope: any character may appear in a source id. */
  private readonly layouts = new Map<
    string,
    { scope: LayoutScope; positions: Map<string, TablePosition> }
  >()

  async get(scope: LayoutScope) {
    return [...(this.layouts.get(this.key(scope))?.positions.values() ?? [])]
  }
  async upsert(scope: LayoutScope, positions: TablePosition[]) {
    const key = this.key(scope)
    const layout = this.layouts.get(key) ?? { scope, positions: new Map<string, TablePosition>() }
    for (const position of positions) layout.positions.set(position.table, position)
    this.layouts.set(key, layout)
  }
  async listScopes(userId: string, repo: KnownRepo) {
    return [...this.layouts.values()]
      .filter(
        ({ scope, positions }) =>
          scope.userId === userId && repoKey(scope.repo) === repoKey(repo) && positions.size > 0,
      )
      .map(({ scope }) => ({ sourceId: scope.sourceId, mode: scope.mode }))
  }
  private key(scope: LayoutScope) {
    return JSON.stringify([scope.userId, repoKey(scope.repo), scope.sourceId, scope.mode])
  }
}

/** Like SQLite's BINARY collation, unlike localeCompare. */
const byCodePoints = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export class InMemoryUserRepository implements UserRepository {
  readonly users = new Map<string, AppUser>()
  readonly tokens = new Map<string, UserTokens>()
  readonly lastSeen = new Map<string, Date>()

  async upsert(profile: UserProfile) {
    for (const [id, other] of this.users) {
      if (id !== profile.id && other.login.toLowerCase() === profile.login.toLowerCase()) {
        this.users.set(id, { ...other, login: `${other.login}${STALE_LOGIN_SUFFIX}` })
      }
    }
    const existing = this.users.get(profile.id)
    this.users.set(profile.id, { ...profile, isAdmin: existing?.isAdmin ?? false })
  }
  async get(id: string) {
    return this.users.get(id) ?? null
  }
  async setAdmin(id: string, isAdmin: boolean) {
    const user = this.users.get(id)
    if (user) this.users.set(id, { ...user, isAdmin })
  }
  async countAdmins() {
    return [...this.users.values()].filter((user) => user.isAdmin).length
  }
  async promoteFirstAdmin(id: string) {
    const user = this.users.get(id)
    if (!user || [...this.users.values()].some((other) => other.isAdmin)) return false
    this.users.set(id, { ...user, isAdmin: true })
    return true
  }
  async getTokens(id: string) {
    return this.tokens.get(id) ?? null
  }
  async saveTokens(id: string, tokens: UserTokens | null) {
    if (tokens) this.tokens.set(id, tokens)
    else this.tokens.delete(id)
  }
  async listAdmins() {
    return [...this.users.values()]
      .filter((user) => user.isAdmin)
      .sort((a, b) => byCodePoints(a.login.toLowerCase(), b.login.toLowerCase()))
  }
  async findByLogin(login: string) {
    // Map order is creation order (upserts keep it): the most recent account wins, like SQLite.
    const wanted = login.toLowerCase()
    return [...this.users.values()].findLast((user) => user.login.toLowerCase() === wanted) ?? null
  }
  async demoteAdmin(id: string) {
    // Check and set in one synchronous step, like the atomic SQL statement.
    const user = this.users.get(id)
    const admins = [...this.users.values()].filter((other) => other.isAdmin).length
    if (!user?.isAdmin || admins === 1) return false
    this.users.set(id, { ...user, isAdmin: false })
    return true
  }
  async clearAllTokens() {
    const count = this.tokens.size
    this.tokens.clear()
    return count
  }

  async listUsers(): Promise<UserRecord[]> {
    return [...this.users.values()]
      .sort(
        (a, b) =>
          byCodePoints(a.login.toLowerCase(), b.login.toLowerCase()) || byCodePoints(a.id, b.id),
      )
      .map((user) => ({ ...user, lastSeenAt: this.lastSeen.get(user.id) ?? null }))
  }
  async recordActivity(id: string, at: Date) {
    if (this.users.has(id)) this.lastSeen.set(id, at)
  }
}

export class InMemoryInstanceConfig implements InstanceConfigRepository {
  config: InstanceConfig = EMPTY_INSTANCE_CONFIG

  async get() {
    return this.config
  }
  async update(patch: Partial<InstanceConfig>) {
    this.config = { ...this.config, ...patch }
  }
}

export class InMemorySessionRepository implements SessionRepository {
  readonly sessions = new Map<string, StoredSession>()

  async create(session: StoredSession) {
    this.sessions.set(session.idHash, session)
  }
  async find(idHash: string) {
    return this.sessions.get(idHash) ?? null
  }
  async touch(idHash: string, lastSeenAt: Date, expiresAt: Date) {
    const session = this.sessions.get(idHash)
    if (session) this.sessions.set(idHash, { ...session, lastSeenAt, expiresAt })
  }
  async delete(idHash: string) {
    this.sessions.delete(idHash)
  }
  async deleteExpired(now: Date) {
    let count = 0
    for (const [idHash, session] of this.sessions) {
      if (session.expiresAt <= now || isPastMaxAge(session.createdAt, now)) {
        this.sessions.delete(idHash)
        count++
      }
    }
    return count
  }

  async deleteForUser(userId: string) {
    let count = 0
    for (const [idHash, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.delete(idHash)
        count++
      }
    }
    return count
  }

  async deleteAll() {
    const count = this.sessions.size
    this.sessions.clear()
    return count
  }

  async countActiveByUser(now: Date) {
    const counts = new Map<string, number>()
    for (const session of this.sessions.values()) {
      if (session.expiresAt <= now || isPastMaxAge(session.createdAt, now)) continue
      counts.set(session.userId, (counts.get(session.userId) ?? 0) + 1)
    }
    return counts
  }
}
