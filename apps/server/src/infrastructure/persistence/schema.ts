import type { DbSchema, DetectedSource, DisplayMode, ManualSource } from '@repoerd/model'
import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  login: text('login').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  avatarUrl: text('avatar_url'),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  /** Sealed with the secret box. */
  accessToken: text('access_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
  /** Sealed with the secret box. */
  refreshToken: text('refresh_token'),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  /** Last sign-in or session renewal (renewals happen at most once a day). */
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
})

export const sessions = sqliteTable('sessions', {
  idHash: text('id_hash').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

/** A single row (id = 1). */
export const instanceConfig = sqliteTable('instance_config', {
  id: integer('id').primaryKey(),
  publicUrl: text('public_url'),
  appId: integer('app_id'),
  appSlug: text('app_slug'),
  appName: text('app_name'),
  appHtmlUrl: text('app_html_url'),
  appOwnerLogin: text('app_owner_login'),
  /** 'User' or 'Organization' (null for Apps saved before plan 3b: treated as 'User'). */
  appOwnerType: text('app_owner_type'),
  clientId: text('client_id'),
  /** Sealed with the secret box. */
  clientSecret: text('client_secret'),
  /** Sealed with the secret box. */
  privateKey: text('private_key'),
  /** JSON array of lower-case logins. */
  allowedOrgs: text('allowed_orgs').notNull().default('[]'),
  setupCodeHash: text('setup_code_hash'),
  setupGrantHash: text('setup_grant_hash'),
  setupGrantExpiresAt: integer('setup_grant_expires_at', { mode: 'timestamp_ms' }),
  /** 'real' or 'fake': recorded at the first start; the other mode is refused afterwards. */
  githubMode: text('github_mode'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const layouts = sqliteTable(
  'layouts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The repository's GitHub id; rows saved before plan 6d: lower-case owner/name, until adopted. */
    repo: text('repo').notNull(),
    sourceId: text('source_id').notNull(),
    mode: text('mode').$type<DisplayMode>().notNull().default('ALL_FIELDS'),
    tableName: text('table_name').notNull(),
    x: real('x').notNull(),
    y: real('y').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.repo, table.sourceId, table.mode, table.tableName],
    }),
    index('layouts_repo_idx').on(table.repo),
  ],
)

export const schemaDetectionCache = sqliteTable(
  'schema_detection_cache',
  {
    /** The repository's GitHub id; rows saved before plan 6d: lower-case owner/name, until adopted. */
    repo: text('repo').notNull(),
    commitSha: text('commit_sha').notNull(),
    /** 'auto', or a hash of the repository's manual sources. */
    settingsKey: text('settings_key').notNull(),
    /** CACHE_VERSION of @repoerd/schema-core when the row was written. */
    cacheVersion: integer('cache_version').notNull(),
    sources: text('sources', { mode: 'json' }).$type<DetectedSource[]>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.repo, table.commitSha, table.settingsKey, table.cacheVersion],
    }),
    index('schema_detection_cache_created_at_idx').on(table.createdAt),
  ],
)

export const schemaCache = sqliteTable(
  'schema_cache',
  {
    /** The repository's GitHub id; rows saved before plan 6d: lower-case owner/name, until adopted. */
    repo: text('repo').notNull(),
    commitSha: text('commit_sha').notNull(),
    sourceId: text('source_id').notNull(),
    /** Hash of the format and of every path:blobSha of the source. */
    filesKey: text('files_key').notNull(),
    /** CACHE_VERSION of @repoerd/schema-core when the row was written. */
    cacheVersion: integer('cache_version').notNull(),
    schema: text('schema', { mode: 'json' }).$type<DbSchema>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.repo, table.commitSha, table.sourceId, table.filesKey, table.cacheVersion],
    }),
    index('schema_cache_created_at_idx').on(table.createdAt),
  ],
)

export const repoSettings = sqliteTable('repo_settings', {
  /** The repository's GitHub id; rows saved before plan 6d: lower-case owner/name, until adopted. */
  repo: text('repo').primaryKey(),
  sources: text('sources', { mode: 'json' }).$type<ManualSource[]>().notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  updatedBy: text('updated_by'),
})

export const blobCache = sqliteTable(
  'blob_cache',
  {
    sha: text('sha').primaryKey(),
    content: text('content').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`0`),
  },
  (table) => [index('blob_cache_created_at_idx').on(table.createdAt)],
)
