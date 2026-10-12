import { eq } from 'drizzle-orm'
import {
  EMPTY_INSTANCE_CONFIG,
  type GitHubAppCredentials,
  type InstanceConfig,
  type InstanceConfigRepository,
} from '../../application/ports/instance-config.js'
import type { SecretBox } from '../../application/ports/secret-box.js'
import type { AppDatabase } from './database.js'
import { instanceConfig } from './schema.js'

const ROW_ID = 1
type Row = typeof instanceConfig.$inferSelect
type Columns = Partial<typeof instanceConfig.$inferInsert>

/** Anything but a JSON array of strings means no restriction (never a crash at startup). */
function parseAllowedOrgs(stored: string): string[] {
  try {
    const value: unknown = JSON.parse(stored)
    return Array.isArray(value) && value.every((org) => typeof org === 'string') ? value : []
  } catch {
    return []
  }
}

/** The fields the patch really carries (an explicit `undefined` is no change). */
const definedFields = (patch: Partial<InstanceConfig>): Partial<InstanceConfig> =>
  Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))

/**
 * Single-row table, cached in memory. Another process (repoerd-admin) may change it while this
 * one runs: an update writes only the columns of its own fields, so it never writes back a value
 * that process changed, and it never opens the sealed secrets (any SECRET_KEY can update).
 */
export class SqliteInstanceConfigRepository implements InstanceConfigRepository {
  private cached: InstanceConfig | null = null

  constructor(
    private readonly db: AppDatabase,
    private readonly box: SecretBox,
  ) {}

  async get(): Promise<InstanceConfig> {
    // A copy: a caller changing what it got must not change the cache.
    return structuredClone(this.current())
  }

  /** One statement, without awaiting: concurrent updates keep every field. */
  async update(patch: Partial<InstanceConfig>): Promise<void> {
    const columns = this.columnsOf(patch)
    this.db
      .insert(instanceConfig)
      .values({
        ...this.columnsOf(EMPTY_INSTANCE_CONFIG),
        ...columns,
        id: ROW_ID,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({ target: instanceConfig.id, set: columns })
      .run()
    // Not loaded yet: the next read takes everything from the database.
    if (this.cached) this.cached = structuredClone({ ...this.cached, ...definedFields(patch) })
  }

  private current(): InstanceConfig {
    if (!this.cached) {
      const row = this.db.select().from(instanceConfig).where(eq(instanceConfig.id, ROW_ID)).get()
      this.cached = row ? this.fromRow(row) : EMPTY_INSTANCE_CONFIG
    }
    return this.cached
  }

  /** The columns of the fields present in the patch, and the update date. */
  private columnsOf(patch: Partial<InstanceConfig>): Columns {
    const columns: Columns = { updatedAt: new Date() }
    if (patch.publicUrl !== undefined) columns.publicUrl = patch.publicUrl
    if (patch.app !== undefined) Object.assign(columns, this.appColumns(patch.app))
    if (patch.allowedOrgs !== undefined) columns.allowedOrgs = JSON.stringify(patch.allowedOrgs)
    if (patch.setupCodeHash !== undefined) columns.setupCodeHash = patch.setupCodeHash
    if (patch.setupGrant !== undefined) {
      columns.setupGrantHash = patch.setupGrant?.hash ?? null
      columns.setupGrantExpiresAt = patch.setupGrant?.expiresAt ?? null
    }
    if (patch.githubMode !== undefined) columns.githubMode = patch.githubMode
    return columns
  }

  /** The App's columns, its secrets sealed; every column null to forget the App. */
  private appColumns(app: GitHubAppCredentials | null): Columns {
    return {
      appId: app?.appId ?? null,
      appSlug: app?.slug ?? null,
      appName: app?.name ?? null,
      appHtmlUrl: app?.htmlUrl ?? null,
      appOwnerLogin: app?.ownerLogin ?? null,
      appOwnerType: app?.ownerType ?? null,
      clientId: app?.clientId ?? null,
      clientSecret: app ? this.box.seal(app.clientSecret) : null,
      privateKey: app ? this.box.seal(app.privateKey) : null,
    }
  }

  private fromRow(row: Row): InstanceConfig {
    return {
      publicUrl: row.publicUrl,
      app: this.appFromRow(row),
      allowedOrgs: parseAllowedOrgs(row.allowedOrgs),
      setupCodeHash: row.setupCodeHash,
      setupGrant:
        row.setupGrantHash && row.setupGrantExpiresAt !== null
          ? { hash: row.setupGrantHash, expiresAt: row.setupGrantExpiresAt }
          : null,
      githubMode: row.githubMode === 'real' || row.githubMode === 'fake' ? row.githubMode : null,
    }
  }

  private appFromRow(row: Row): GitHubAppCredentials | null {
    const {
      appId,
      appSlug,
      appName,
      appHtmlUrl,
      appOwnerLogin,
      appOwnerType,
      clientId,
      clientSecret,
      privateKey,
    } = row
    if (appId === null || !appSlug || !appName || !appHtmlUrl || appOwnerLogin === null) return null
    if (!clientId || !clientSecret || !privateKey) return null
    return {
      appId,
      slug: appSlug,
      name: appName,
      htmlUrl: appHtmlUrl,
      ownerLogin: appOwnerLogin,
      ownerType: appOwnerType === 'Organization' ? 'Organization' : 'User',
      clientId,
      clientSecret: this.box.open(clientSecret),
      privateKey: this.box.open(privateKey),
    }
  }
}
