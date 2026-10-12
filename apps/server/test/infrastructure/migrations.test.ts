import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CACHE_VERSION } from '@repoerd/schema-core'
import Database from 'better-sqlite3'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, describe, expect, it } from 'vitest'
import { createSecretBox } from '../../src/infrastructure/crypto/secret-box.js'
import { openDatabase } from '../../src/infrastructure/persistence/database.js'
import {
  blobCache,
  instanceConfig,
  schemaCache,
  schemaDetectionCache,
  sessions as sessionsTable,
} from '../../src/infrastructure/persistence/schema.js'
import { SqliteBlobCache } from '../../src/infrastructure/persistence/sqlite-blob-cache.js'
import { SqliteLayoutRepository } from '../../src/infrastructure/persistence/sqlite-layout-repository.js'
import { SqliteLegacyRepoKeys } from '../../src/infrastructure/persistence/sqlite-legacy-repo-keys.js'
import { SqliteRepoSettingsRepository } from '../../src/infrastructure/persistence/sqlite-repo-settings-repository.js'
import { SqliteSchemaCache } from '../../src/infrastructure/persistence/sqlite-schema-cache.js'
import { SqliteUserRepository } from '../../src/infrastructure/persistence/sqlite-user-repository.js'

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))
let workDir: string | undefined

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true })
  workDir = undefined
})

/** A database file as an install that only ever ran the first migration left it. */
function databaseAtFirstMigration(dir: string): string {
  const firstOnly = path.join(dir, 'migrations')
  mkdirSync(path.join(firstOnly, 'meta'), { recursive: true })
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8'))
  journal.entries = journal.entries.slice(0, 1)
  writeFileSync(path.join(firstOnly, 'meta/_journal.json'), JSON.stringify(journal))
  copyFileSync(
    path.join(MIGRATIONS, `${journal.entries[0].tag}.sql`),
    path.join(firstOnly, `${journal.entries[0].tag}.sql`),
  )

  const file = path.join(dir, 'db.sqlite')
  const sqlite = new Database(file)
  migrate(drizzle({ client: sqlite }), { migrationsFolder: firstOnly })
  sqlite.prepare("INSERT INTO users (id, login, created_at) VALUES ('alice', 'alice', 0)").run()
  sqlite.prepare("INSERT INTO blob_cache (sha, content) VALUES ('b1', 'B')").run()
  sqlite
    .prepare(
      `INSERT INTO layouts (user_id, repo, source_id, table_name, x, y, updated_at)
       VALUES ('alice', 'acme/shop', 'prisma/schema.prisma', 'users', 12, 34, 0)`,
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO schema_detection_cache (repo, commit_sha, sources, created_at)
       VALUES ('acme/shop', 'c1', '[]', 0)`,
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO schema_cache (repo, commit_sha, source_id, schema, created_at)
       VALUES ('acme/shop', 'c1', 'prisma/schema.prisma', '{"tables":[]}', 0)`,
    )
    .run()
  sqlite.close()
  return file
}

/** A database file migrated up to, but not including, the migration `tag`. */
function databaseBefore(dir: string, tag: string): string {
  const older = path.join(dir, 'older-migrations')
  mkdirSync(path.join(older, 'meta'), { recursive: true })
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8'))
  const index = journal.entries.findIndex((entry: { tag: string }) => entry.tag === tag)
  if (index < 0) throw new Error(`No migration ${tag}`)
  journal.entries = journal.entries.slice(0, index)
  writeFileSync(path.join(older, 'meta/_journal.json'), JSON.stringify(journal))
  for (const entry of journal.entries as { tag: string }[]) {
    copyFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), path.join(older, `${entry.tag}.sql`))
  }
  const file = path.join(dir, 'before.sqlite')
  const sqlite = new Database(file)
  migrate(drizzle({ client: sqlite }), { migrationsFolder: older })
  sqlite.close()
  return file
}

/** The tags of the migration journal, oldest first. */
const TAGS = (
  JSON.parse(readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[]
  }
).entries.map((entry) => entry.tag)

/** A database file as an install that ran the first `count` migrations of the journal left it. */
function databaseAfter(dir: string, count: number): string {
  const older = path.join(dir, `migrations-${count}`)
  mkdirSync(path.join(older, 'meta'), { recursive: true })
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8'))
  journal.entries = journal.entries.slice(0, count)
  writeFileSync(path.join(older, 'meta/_journal.json'), JSON.stringify(journal))
  for (const entry of journal.entries as { tag: string }[]) {
    copyFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), path.join(older, `${entry.tag}.sql`))
  }
  const file = path.join(dir, `after-${count}.sqlite`)
  const sqlite = new Database(file)
  migrate(drizzle({ client: sqlite }), { migrationsFolder: older })
  sqlite.close()
  return file
}

const MANUAL_SOURCES = [{ name: 'core', format: 'prisma', paths: ['db/schema.prisma'] }]

/** One row per table, by column: a version that lacks a table or a column just skips it. */
const ROWS: Record<string, Record<string, string | number>> = {
  users: {
    id: 'alice',
    login: 'alice',
    created_at: 0,
    avatar_url: 'https://avatars.example/alice',
    is_admin: 1,
    last_seen_at: 7000,
  },
  layouts: {
    user_id: 'alice',
    repo: 'acme/shop',
    source_id: 'prisma/schema.prisma',
    mode: 'ALL_FIELDS',
    table_name: 'users',
    x: 12,
    y: 34,
    updated_at: 0,
  },
  sessions: {
    id_hash: 'h1',
    user_id: 'alice',
    expires_at: 9_000_000_000_000,
    last_seen_at: 5000,
    created_at: 1000,
  },
  instance_config: {
    id: 1,
    public_url: 'https://erd.example.com',
    app_id: 42,
    app_slug: 'repoerd',
    app_name: 'RepoERD',
    app_html_url: 'https://github.com/apps/repoerd',
    app_owner_login: 'acme',
    app_owner_type: 'Organization',
    client_id: 'Iv1.client',
    allowed_orgs: '["acme"]',
    github_mode: 'real',
    updated_at: 0,
  },
  repo_settings: {
    repo: 'acme/shop',
    sources: JSON.stringify(MANUAL_SOURCES),
    updated_at: 0,
    updated_by: 'alice',
  },
  blob_cache: { sha: 'b1', content: 'B', created_at: 1000 },
  schema_detection_cache: {
    repo: 'acme/shop',
    commit_sha: 'c1',
    settings_key: 'auto',
    cache_version: CACHE_VERSION,
    sources: '[]',
    created_at: 1000,
  },
  schema_cache: {
    repo: 'acme/shop',
    commit_sha: 'c1',
    source_id: 'prisma/schema.prisma',
    files_key: 'k',
    cache_version: CACHE_VERSION,
    schema: '{"tables":{}}',
    created_at: 1000,
  },
}

/** Fills every table the database has at its version with the columns it has. */
function populate(file: string) {
  const sqlite = new Database(file)
  try {
    for (const [table, values] of Object.entries(ROWS)) {
      const columns = (
        sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      ).map((column) => column.name)
      const present = Object.keys(values).filter((column) => columns.includes(column))
      if (present.length === 0) continue
      sqlite
        .prepare(
          `INSERT INTO ${table} (${present.join(', ')}) VALUES (${present.map(() => '?').join(', ')})`,
        )
        .run(...present.map((column) => values[column] ?? null))
    }
  } finally {
    sqlite.close()
  }
}

describe('migrations', () => {
  it.each([
    { name: 'locks the mode of a database that has an App to real', appId: 42, mode: 'real' },
    { name: 'leaves a mode-less database without an App open', appId: null, mode: null },
  ])('$name', ({ appId, mode }) => {
    workDir = mkdtempSync(path.join(tmpdir(), 'repoerd-migrations-'))
    const file = databaseBefore(workDir, '0006_user_last_seen')
    const sqlite = new Database(file)
    sqlite
      .prepare('INSERT INTO instance_config (id, app_id, updated_at) VALUES (1, ?, 0)')
      .run(appId)
    sqlite.close()
    const { db, close } = openDatabase(file)
    try {
      expect(db.select().from(instanceConfig).all()).toMatchObject([{ githubMode: mode }])
    } finally {
      close()
    }
  })

  it('dates the last activity of each user from their latest session', async () => {
    workDir = mkdtempSync(path.join(tmpdir(), 'repoerd-migrations-'))
    const file = databaseBefore(workDir, '0006_user_last_seen')
    const sqlite = new Database(file)
    sqlite
      .prepare(
        "INSERT INTO users (id, login, created_at) VALUES ('alice', 'alice', 0), ('bob', 'bob', 0)",
      )
      .run()
    sqlite
      .prepare(
        `INSERT INTO sessions (id_hash, user_id, expires_at, last_seen_at, created_at)
         VALUES ('a1', 'alice', 9000000000000, 1000, 0), ('a2', 'alice', 9000000000000, 5000, 0)`,
      )
      .run()
    sqlite.close()
    const { db, close } = openDatabase(file)
    try {
      const users = await new SqliteUserRepository(db, createSecretBox('k'.repeat(32))).listUsers()
      expect(users.map(({ id, lastSeenAt }) => ({ id, lastSeenAt }))).toEqual([
        { id: 'alice', lastSeenAt: new Date(5000) },
        { id: 'bob', lastSeenAt: null },
      ])
    } finally {
      close()
    }
  })

  it('keeps layouts saved before display modes, as the "All fields" layout', async () => {
    workDir = mkdtempSync(path.join(tmpdir(), 'repoerd-migrations-'))
    const { db, close } = openDatabase(databaseAtFirstMigration(workDir))
    try {
      await new SqliteLegacyRepoKeys(db).adopt('acme/shop', 42)
      const layouts = new SqliteLayoutRepository(db)
      const scope = {
        userId: 'alice',
        repo: { id: 42, owner: 'acme', name: 'shop' },
        sourceId: 'prisma/schema.prisma',
      }
      expect(await layouts.get({ ...scope, mode: 'ALL_FIELDS' })).toEqual([
        { table: 'users', x: 12, y: 34 },
      ])
      expect(await layouts.get({ ...scope, mode: 'TABLE_NAME' })).toEqual([])
    } finally {
      close()
    }
  })

  it('keeps users and layouts through the auth migration', async () => {
    workDir = mkdtempSync(path.join(tmpdir(), 'repoerd-migrations-'))
    const { db, close } = openDatabase(databaseAtFirstMigration(workDir))
    try {
      await new SqliteLegacyRepoKeys(db).adopt('acme/shop', 42)
      const users = new SqliteUserRepository(db, createSecretBox('k'.repeat(32)))
      expect(await users.get('alice')).toEqual({
        id: 'alice',
        login: 'alice',
        avatarUrl: null,
        isAdmin: false,
      })
      expect(
        await new SqliteLayoutRepository(db).get({
          userId: 'alice',
          repo: { id: 42, owner: 'acme', name: 'shop' },
          sourceId: 'prisma/schema.prisma',
          mode: 'ALL_FIELDS',
        }),
      ).toEqual([{ table: 'users', x: 12, y: 34 }])
    } finally {
      close()
    }
  })

  it('versions the caches and dates the blobs cached before, keeping them', async () => {
    workDir = mkdtempSync(path.join(tmpdir(), 'repoerd-migrations-'))
    const before = Math.floor(Date.now() / 1000) * 1000
    const { db, close } = openDatabase(databaseAtFirstMigration(workDir))
    try {
      expect(await new SqliteBlobCache(db).getMany(['b1'])).toEqual(new Map([['b1', 'B']]))
      const [blob] = db.select().from(blobCache).all()
      expect(blob?.createdAt.getTime()).toBeGreaterThanOrEqual(before)
      await new SqliteSchemaCache(db).saveDetection(
        { id: 42, owner: 'acme', name: 'shop' },
        'c1',
        [],
        [],
      )
      expect(db.select().from(schemaDetectionCache).all()).toMatchObject([
        { cacheVersion: CACHE_VERSION },
      ])
    } finally {
      close()
    }
  })

  it('adds repository settings and rebuilds the caches with their new keys', async () => {
    workDir = mkdtempSync(path.join(tmpdir(), 'repoerd-migrations-'))
    const { db, close } = openDatabase(databaseAtFirstMigration(workDir))
    try {
      await new SqliteLegacyRepoKeys(db).adopt('acme/shop', 42)
      const repo = { id: 42, owner: 'acme', name: 'shop' }
      expect(await new SqliteRepoSettingsRepository(db).get(repo)).toEqual([])
      // The caches are recreated with their new keys: the rows cached before are gone.
      expect(db.select().from(schemaDetectionCache).all()).toEqual([])
      expect(db.select().from(schemaCache).all()).toEqual([])
      const cache = new SqliteSchemaCache(db)
      expect(await cache.getDetection(repo, 'c1', [])).toBeNull()
      expect(
        await cache.getSchema(repo, 'c1', {
          source: {
            id: 'prisma/schema.prisma',
            name: 'prisma/schema.prisma',
            format: 'prisma',
            origin: 'detected',
          },
          files: [{ path: 'prisma/schema.prisma', sha: 's1', size: 1 }],
          problem: null,
        }),
      ).toBeNull()
      expect(
        await new SqliteLayoutRepository(db).get({
          userId: 'alice',
          repo,
          sourceId: 'prisma/schema.prisma',
          mode: 'ALL_FIELDS',
        }),
      ).toEqual([{ table: 'users', x: 12, y: 34 }])
    } finally {
      close()
    }
  })

  it('indexes the layouts by repository and leaves the rows saved by name to their adoption', async () => {
    workDir = mkdtempSync(path.join(tmpdir(), 'repoerd-migrations-'))
    const file = databaseBefore(workDir, '0007_repo_id_keys')
    const sqlite = new Database(file)
    sqlite.prepare("INSERT INTO users (id, login, created_at) VALUES ('alice', 'alice', 0)").run()
    sqlite
      .prepare(
        `INSERT INTO layouts (user_id, repo, source_id, mode, table_name, x, y, updated_at)
         VALUES ('alice', 'acme/shop', 'prisma/schema.prisma', 'ALL_FIELDS', 'users', 12, 34, 0)`,
      )
      .run()
    sqlite.close()
    const { db, close } = openDatabase(file)
    try {
      const indexes = db.all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'layouts'`,
      )
      expect(indexes.map((index) => index.name)).toContain('layouts_repo_idx')
      await new SqliteLegacyRepoKeys(db).adopt('acme/shop', 42)
      expect(
        await new SqliteLayoutRepository(db).get({
          userId: 'alice',
          repo: { id: 42, owner: 'acme', name: 'shop' },
          sourceId: 'prisma/schema.prisma',
          mode: 'ALL_FIELDS',
        }),
      ).toEqual([{ table: 'users', x: 12, y: 34 }])
    } finally {
      close()
    }
  })
})

describe('upgrades from every version of the database', () => {
  it.each(TAGS.map((tag, index) => ({ tag, count: index + 1 })))(
    'keeps the data of a database last migrated to $tag',
    async ({ count }) => {
      workDir = mkdtempSync(path.join(tmpdir(), 'repoerd-migrations-'))
      const file = databaseAfter(workDir, count)
      populate(file)
      const ran = (tag: string) => TAGS.indexOf(tag) < count
      const auth = ran('0002_auth_and_setup')
      const repoSettingsExist = ran('0003_repo_settings_and_cache_keys')

      const { db, close } = openDatabase(file)
      try {
        await new SqliteLegacyRepoKeys(db).adopt('acme/shop', 42)
        const repo = { id: 42, owner: 'acme', name: 'shop' }
        const users = new SqliteUserRepository(db, createSecretBox('k'.repeat(32)))
        expect(await users.get('alice')).toEqual({
          id: 'alice',
          login: 'alice',
          avatarUrl: auth ? 'https://avatars.example/alice' : null,
          isAdmin: auth,
        })
        // 0006 dates the last activity from the latest session; from 0006 on it is stored.
        const [alice] = await users.listUsers()
        expect(alice?.lastSeenAt).toEqual(
          ran('0006_user_last_seen') ? new Date(7000) : auth ? new Date(5000) : null,
        )
        expect(
          db
            .select()
            .from(sessionsTable)
            .all()
            .map((session) => session.idHash),
        ).toEqual(auth ? ['h1'] : [])
        expect(db.select().from(instanceConfig).all()).toMatchObject(
          auth
            ? [
                {
                  appId: 42,
                  publicUrl: 'https://erd.example.com',
                  allowedOrgs: '["acme"]',
                  githubMode: 'real',
                  appOwnerType: repoSettingsExist ? 'Organization' : null,
                },
              ]
            : [],
        )
        expect(await new SqliteRepoSettingsRepository(db).get(repo)).toEqual(
          repoSettingsExist ? MANUAL_SOURCES : [],
        )
        expect(
          await new SqliteLayoutRepository(db).get({
            userId: 'alice',
            repo,
            sourceId: 'prisma/schema.prisma',
            mode: 'ALL_FIELDS',
          }),
        ).toEqual([{ table: 'users', x: 12, y: 34 }])
        expect(await new SqliteBlobCache(db).getMany(['b1'])).toEqual(new Map([['b1', 'B']]))
        // 0003 and 0004 rebuild the derived caches: rows cached before 0004 are gone.
        const cachesKept = ran('0004_cache_version_and_retention')
        expect(db.select().from(schemaDetectionCache).all()).toHaveLength(cachesKept ? 1 : 0)
        expect(db.select().from(schemaCache).all()).toHaveLength(cachesKept ? 1 : 0)
      } finally {
        close()
      }
    },
  )
})
