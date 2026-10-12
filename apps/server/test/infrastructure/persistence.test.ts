import type { DbSchema, DetectedSource, ManualSource } from '@repoerd/model'
import { CACHE_VERSION } from '@repoerd/schema-core'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EMPTY_INSTANCE_CONFIG,
  type GitHubAppCredentials,
} from '../../src/application/ports/instance-config.js'
import type { SecretBox } from '../../src/application/ports/secret-box.js'
import { createSecretBox } from '../../src/infrastructure/crypto/secret-box.js'
import { purgeCaches } from '../../src/infrastructure/persistence/cache-retention.js'
import {
  type AppDatabase,
  openDatabase,
  pingDatabase,
} from '../../src/infrastructure/persistence/database.js'
import {
  instanceConfig,
  layouts as layoutsTable,
  repoSettings as repoSettingsTable,
  schemaDetectionCache as schemaDetectionCacheTable,
  users as usersTable,
} from '../../src/infrastructure/persistence/schema.js'
import { SqliteBlobCache } from '../../src/infrastructure/persistence/sqlite-blob-cache.js'
import { SqliteInstanceConfigRepository } from '../../src/infrastructure/persistence/sqlite-instance-config-repository.js'
import { SqliteLayoutRepository } from '../../src/infrastructure/persistence/sqlite-layout-repository.js'
import { SqliteLegacyRepoKeys } from '../../src/infrastructure/persistence/sqlite-legacy-repo-keys.js'
import { SqliteRepoSettingsRepository } from '../../src/infrastructure/persistence/sqlite-repo-settings-repository.js'
import { SqliteSchemaCache } from '../../src/infrastructure/persistence/sqlite-schema-cache.js'
import { SqliteUserRepository } from '../../src/infrastructure/persistence/sqlite-user-repository.js'

const repo = { id: 7, owner: 'Acme', name: 'Shop' }
const source = 'prisma/schema.prisma'
const box = createSecretBox('k'.repeat(32))
let db: AppDatabase
let close: () => void

beforeEach(async () => {
  ;({ db, close } = openDatabase(':memory:'))
  const users = new SqliteUserRepository(db, box)
  await users.upsert({ id: 'alice', login: 'alice', avatarUrl: null })
  await users.upsert({ id: 'bob', login: 'bob', avatarUrl: null })
})
afterEach(() => close())

describe('pingDatabase', () => {
  it('answers while the database is open, and throws once it is closed', () => {
    const opened = openDatabase(':memory:')
    expect(() => pingDatabase(opened.db)).not.toThrow()
    opened.close()
    expect(() => pingDatabase(opened.db)).toThrow()
  })
})

describe('SqliteSchemaCache', () => {
  const detection: DetectedSource[] = [
    {
      source: { id: source, name: source, format: 'prisma', origin: 'detected' },
      files: [{ path: source, sha: 'abc', size: 3 }],
      problem: null,
    },
  ]
  const schema: DbSchema = { tables: {}, enums: {}, relationships: [] }
  const manual: ManualSource[] = [{ name: 'core', format: 'prisma', paths: ['db'] }]

  it('stores detections by commit and settings, and ignores duplicate saves', async () => {
    const cache = new SqliteSchemaCache(db)
    expect(await cache.getDetection(repo, 'c1', [])).toBeNull()
    await cache.saveDetection(repo, 'c1', [], detection)
    await cache.saveDetection(repo, 'c1', [], detection)

    expect(await cache.getDetection({ id: 7, owner: 'acme', name: 'shop' }, 'c1', [])).toEqual(
      detection,
    )
    // Other manual sources, same commit: a different detection.
    expect(await cache.getDetection(repo, 'c1', manual)).toBeNull()
    await cache.saveDetection(repo, 'c1', manual, [])
    expect(await cache.getDetection(repo, 'c1', manual)).toEqual([])
    expect(await cache.getDetection(repo, 'c1', [])).toEqual(detection)
  })

  it('stores schemas by commit and by the exact files of the source', async () => {
    const cache = new SqliteSchemaCache(db)
    const [detected] = detection
    if (!detected) throw new Error('fixture')
    await cache.saveSchema(repo, 'c1', detected, schema)
    await cache.saveSchema(repo, 'c1', detected, schema)
    expect(await cache.getSchema(repo, 'c1', detected)).toEqual(schema)
    expect(await cache.getSchema(repo, 'c2', detected)).toBeNull()

    // Same id, other files (a redefined manual source): never the old schema.
    const redefined = {
      ...detected,
      files: [...detected.files, { path: 'db/b.prisma', sha: 'def', size: 3 }],
    }
    expect(await cache.getSchema(repo, 'c1', redefined)).toBeNull()
    expect(
      await cache.getSchema(repo, 'c1', {
        ...detected,
        source: { ...detected.source, format: 'drizzle' },
      }),
    ).toBeNull()
  })

  it('never confuses two file sets whose paths would join to the same text', async () => {
    const cache = new SqliteSchemaCache(db)
    const [detected] = detection
    if (!detected) throw new Error('fixture')
    const twoFiles = {
      ...detected,
      files: [
        { path: 'a', sha: '1', size: 1 },
        { path: 'b', sha: '2', size: 1 },
      ],
    }
    const oneFile = { ...detected, files: [{ path: 'a:1\nb', sha: '2', size: 1 }] }
    await cache.saveSchema(repo, 'c1', twoFiles, schema)
    expect(await cache.getSchema(repo, 'c1', oneFile)).toBeNull()
  })
})

describe('cache versions and retention', () => {
  afterEach(() => vi.useRealTimers())
  const detected: DetectedSource = {
    source: { id: source, name: source, format: 'prisma', origin: 'detected' },
    files: [{ path: source, sha: 'abc', size: 3 }],
    problem: null,
  }
  const empty: DbSchema = { tables: {}, enums: {}, relationships: [] }

  it('serves only the rows of its own cache version and deletes the others', async () => {
    const old = new SqliteSchemaCache(db, 1)
    await old.saveDetection(repo, 'c1', [], [detected])
    await old.saveSchema(repo, 'c1', detected, empty)
    const current = new SqliteSchemaCache(db, 2)
    expect(await current.getDetection(repo, 'c1', [])).toBeNull()
    expect(await current.getSchema(repo, 'c1', detected)).toBeNull()
    await current.saveDetection(repo, 'c1', [], [])

    expect(current.deleteOtherVersions()).toBe(2)
    expect(await old.getDetection(repo, 'c1', [])).toBeNull()
    expect(await current.getDetection(repo, 'c1', [])).toEqual([])
  })

  it('deletes the blobs, detections and schemas cached more than 30 days ago', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-01T00:00:00Z'), toFake: ['Date'] })
    const schemas = new SqliteSchemaCache(db)
    const blobs = new SqliteBlobCache(db)
    await schemas.saveDetection(repo, 'old', [], [detected])
    await schemas.saveSchema(repo, 'old', detected, empty)
    await blobs.putMany(new Map([['old-blob', 'A']]))
    vi.setSystemTime(new Date('2026-10-05T00:00:00Z'))
    await schemas.saveDetection(repo, 'new', [], [detected])
    await blobs.putMany(new Map([['new-blob', 'B']]))

    expect(purgeCaches({ schemas, blobs }, new Date('2026-10-11T00:00:00Z'))).toBe(3)
    expect(await schemas.getDetection(repo, 'old', [])).toBeNull()
    expect(await schemas.getSchema(repo, 'old', detected)).toBeNull()
    expect(await schemas.getDetection(repo, 'new', [])).toEqual([detected])
    expect(await blobs.getMany(['old-blob', 'new-blob'])).toEqual(new Map([['new-blob', 'B']]))
  })
})

describe('SqliteRepoSettingsRepository', () => {
  it('saves the manual sources per repository id, and [] removes them', async () => {
    const settings = new SqliteRepoSettingsRepository(db)
    const sources: ManualSource[] = [{ name: 'core', format: 'drizzle', paths: ['src/db/**/*.ts'] }]
    expect(await settings.get(repo)).toEqual([])
    await settings.save(repo, sources, 'alice')
    expect(await settings.get({ id: 7, owner: 'acme', name: 'shop' })).toEqual(sources)
    await settings.save(repo, [], 'alice')
    expect(await settings.get(repo)).toEqual([])
  })
})

describe('SqliteBlobCache', () => {
  it('returns only cached blobs and ignores duplicates', async () => {
    const blobs = new SqliteBlobCache(db)
    await blobs.putMany(
      new Map([
        ['a', 'A'],
        ['b', 'B'],
      ]),
    )
    await blobs.putMany(new Map([['a', 'A']]))

    expect(await blobs.getMany(['a', 'b', 'c'])).toEqual(
      new Map([
        ['a', 'A'],
        ['b', 'B'],
      ]),
    )
  })
})

const APP: GitHubAppCredentials = {
  appId: 42,
  slug: 'repoerd-test',
  name: 'RepoERD test',
  htmlUrl: 'https://github.com/apps/repoerd-test',
  ownerLogin: 'acme',
  ownerType: 'Organization',
  clientId: 'Iv1.client',
  clientSecret: 'client-secret-value',
  privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----',
}

describe('SqliteInstanceConfigRepository', () => {
  it('treats an App saved without owner type as owned by a user', async () => {
    const config = new SqliteInstanceConfigRepository(db, box)
    await config.update({ app: APP })
    db.update(instanceConfig).set({ appOwnerType: null }).run()
    expect((await new SqliteInstanceConfigRepository(db, box).get()).app?.ownerType).toBe('User')
  })

  it('starts empty, merges updates and seals the App secrets', async () => {
    const config = new SqliteInstanceConfigRepository(db, box)
    expect(await config.get()).toEqual({
      publicUrl: null,
      app: null,
      allowedOrgs: [],
      setupCodeHash: null,
      setupGrant: null,
      githubMode: null,
    })

    await config.update({ publicUrl: 'https://erd.example.com', setupCodeHash: 'h1' })
    await config.update({ app: APP, allowedOrgs: ['acme'], githubMode: 'real' })
    expect(await config.get()).toEqual({
      publicUrl: 'https://erd.example.com',
      app: APP,
      allowedOrgs: ['acme'],
      setupCodeHash: 'h1',
      setupGrant: null,
      githubMode: 'real',
    })

    const raw = db.select().from(instanceConfig).where(eq(instanceConfig.id, 1)).get()
    expect(raw?.privateKey).not.toContain('PRIVATE KEY')
    expect(raw?.clientSecret).not.toBe(APP.clientSecret)

    // A fresh repository (no cache) reads the same values back.
    expect((await new SqliteInstanceConfigRepository(db, box).get()).app).toEqual(APP)

    await config.update({ setupGrant: { hash: 'g', expiresAt: new Date(5000) } })
    expect(await new SqliteInstanceConfigRepository(db, box).get()).toMatchObject({
      setupGrant: { hash: 'g', expiresAt: new Date(5000) },
    })
    await config.update({ setupGrant: { hash: 'g', expiresAt: new Date(0) } })
    expect((await new SqliteInstanceConfigRepository(db, box).get()).setupGrant).toEqual({
      hash: 'g',
      expiresAt: new Date(0),
    })
  })

  it('never loses a field when two updates run at once', async () => {
    const config = new SqliteInstanceConfigRepository(db, box)
    await Promise.all([
      config.update({ publicUrl: 'https://erd.example.com' }),
      config.update({ setupCodeHash: 'h1' }),
    ])
    expect(await new SqliteInstanceConfigRepository(db, box).get()).toMatchObject({
      publicUrl: 'https://erd.example.com',
      setupCodeHash: 'h1',
    })
  })

  it('hands out copies, so callers cannot change the cached config', async () => {
    const config = new SqliteInstanceConfigRepository(db, box)
    const empty = await config.get()
    empty.allowedOrgs.push('evil')
    expect((await config.get()).allowedOrgs).toEqual([])
    expect(EMPTY_INSTANCE_CONFIG.allowedOrgs).toEqual([])

    const orgs = ['acme']
    await config.update({ allowedOrgs: orgs, setupGrant: { hash: 'g', expiresAt: new Date(5000) } })
    orgs.push('evil')
    const read = await config.get()
    read.allowedOrgs.push('evil')
    read.setupGrant?.expiresAt.setTime(0)
    expect(await config.get()).toMatchObject({
      allowedOrgs: ['acme'],
      setupGrant: { hash: 'g', expiresAt: new Date(5000) },
    })
  })

  it('writes only the fields it is given, without opening the stored secrets', async () => {
    await new SqliteInstanceConfigRepository(db, box).update({
      publicUrl: 'https://erd.example.com',
      app: APP,
      allowedOrgs: ['acme'],
      githubMode: 'real',
    })
    const refusing: SecretBox = {
      seal: () => {
        throw new Error('sealed a secret')
      },
      open: () => {
        throw new Error('opened a secret')
      },
    }
    const blind = new SqliteInstanceConfigRepository(db, refusing)
    await blind.update({ publicUrl: 'https://new.example.com' })
    await blind.update({ app: null, setupCodeHash: null, setupGrant: null })
    const row = db.select().from(instanceConfig).get()
    expect(row).toMatchObject({
      appId: null,
      appSlug: null,
      appName: null,
      appHtmlUrl: null,
      appOwnerLogin: null,
      appOwnerType: null,
      clientId: null,
      clientSecret: null,
      privateKey: null,
    })
    expect(await new SqliteInstanceConfigRepository(db, box).get()).toEqual({
      publicUrl: 'https://new.example.com',
      app: null,
      allowedOrgs: ['acme'],
      setupCodeHash: null,
      setupGrant: null,
      githubMode: 'real',
    })
  })

  it('never writes back what another process changed when it updates another field', async () => {
    const server = new SqliteInstanceConfigRepository(db, box)
    await server.update({ publicUrl: 'https://erd.example.com', app: APP })
    expect((await server.get()).app).toEqual(APP)
    // repoerd-admin, in another process, forgets the App and moves the public URL.
    await new SqliteInstanceConfigRepository(db, box).update({
      app: null,
      publicUrl: 'https://new.example.com',
    })
    // The server still remembers the old values until it restarts, but its writes keep the new ones.
    await server.update({ allowedOrgs: ['acme'] })
    expect(await new SqliteInstanceConfigRepository(db, box).get()).toMatchObject({
      publicUrl: 'https://new.example.com',
      app: null,
      allowedOrgs: ['acme'],
    })
  })

  it('reads unexpected allowed_orgs values as no restriction', async () => {
    await new SqliteInstanceConfigRepository(db, box).update({ publicUrl: 'https://e.example' })
    for (const stored of ['not json', '{"acme":true}', '"acme"', 'null', '["acme", 42]']) {
      db.update(instanceConfig).set({ allowedOrgs: stored }).where(eq(instanceConfig.id, 1)).run()
      expect((await new SqliteInstanceConfigRepository(db, box).get()).allowedOrgs).toEqual([])
    }
    db.update(instanceConfig)
      .set({ allowedOrgs: '["acme","beta"]' })
      .where(eq(instanceConfig.id, 1))
      .run()
    expect((await new SqliteInstanceConfigRepository(db, box).get()).allowedOrgs).toEqual([
      'acme',
      'beta',
    ])
  })
})

describe('SqliteUserRepository', () => {
  it('stores GitHub tokens sealed and can clear them', async () => {
    const users = new SqliteUserRepository(db, box)
    const tokens = {
      accessToken: 'ghu_secret',
      accessTokenExpiresAt: new Date(1000),
      refreshToken: 'ghr_secret',
      refreshTokenExpiresAt: new Date(2000),
    }
    expect(await users.getTokens('alice')).toBeNull()
    await users.saveTokens('alice', tokens)
    expect(await users.getTokens('alice')).toEqual(tokens)
    const raw = db.select().from(usersTable).where(eq(usersTable.id, 'alice')).get()
    expect(raw?.accessToken).not.toContain('ghu_')
    expect(raw?.refreshToken).not.toContain('ghr_')

    await users.saveTokens('alice', {
      ...tokens,
      accessTokenExpiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
    })
    expect(await users.getTokens('alice')).toMatchObject({ refreshToken: null })
    await users.saveTokens('alice', null)
    expect(await users.getTokens('alice')).toBeNull()
  })
})

describe('SqliteLegacyRepoKeys', () => {
  const shop = { id: 42, owner: 'Acme', name: 'Shop' }
  const core = { name: 'core', format: 'prisma' as const, paths: ['db/schema.prisma'] }
  const at = new Date(0)

  /** Rows as RepoERD saved them before plan 6d: keyed by the lower-case owner/name. */
  function saveLegacyRows() {
    db.insert(layoutsTable)
      .values([
        {
          userId: 'alice',
          repo: 'acme/shop',
          sourceId: source,
          mode: 'ALL_FIELDS',
          tableName: 'users',
          x: 1,
          y: 2,
          updatedAt: at,
        },
        {
          userId: 'bob',
          repo: 'acme/shop',
          sourceId: source,
          mode: 'ALL_FIELDS',
          tableName: 'users',
          x: 5,
          y: 6,
          updatedAt: at,
        },
      ])
      .run()
    db.insert(repoSettingsTable)
      .values({ repo: 'acme/shop', sources: [core], updatedAt: at, updatedBy: 'alice' })
      .run()
    db.insert(schemaDetectionCacheTable)
      .values({
        repo: 'acme/shop',
        commitSha: 'c1',
        settingsKey: 'auto',
        cacheVersion: CACHE_VERSION,
        sources: [],
        createdAt: new Date(),
      })
      .run()
  }
  const layoutOf = (userId: string) =>
    new SqliteLayoutRepository(db).get({ userId, repo: shop, sourceId: source, mode: 'ALL_FIELDS' })
  const legacyLayoutRows = () =>
    db.select().from(layoutsTable).where(eq(layoutsTable.repo, 'acme/shop')).all()

  it('moves every row saved under the name of a repository to its id', async () => {
    saveLegacyRows()
    await new SqliteLegacyRepoKeys(db).adopt('acme/shop', 42)
    expect(await layoutOf('alice')).toEqual([{ table: 'users', x: 1, y: 2 }])
    expect(await layoutOf('bob')).toEqual([{ table: 'users', x: 5, y: 6 }])
    expect(await new SqliteRepoSettingsRepository(db).get(shop)).toEqual([core])
    expect(await new SqliteSchemaCache(db).getDetection(shop, 'c1', [])).toEqual([])
    expect(legacyLayoutRows()).toEqual([])
  })

  it('keeps what was already saved under the id', async () => {
    saveLegacyRows()
    await new SqliteLayoutRepository(db).upsert(
      { userId: 'alice', repo: shop, sourceId: source, mode: 'ALL_FIELDS' },
      [{ table: 'users', x: 100, y: 200 }],
    )
    await new SqliteRepoSettingsRepository(db).save(shop, [{ ...core, name: 'newer' }], 'bob')
    await new SqliteLegacyRepoKeys(db).adopt('acme/shop', 42)
    expect(await layoutOf('alice')).toEqual([{ table: 'users', x: 100, y: 200 }])
    expect(await layoutOf('bob')).toEqual([{ table: 'users', x: 5, y: 6 }])
    expect(await new SqliteRepoSettingsRepository(db).get(shop)).toEqual([
      { ...core, name: 'newer' },
    ])
    expect(legacyLayoutRows()).toEqual([])
  })

  it('ends with the same rows when two requests adopt the same repository at once', async () => {
    saveLegacyRows()
    const keys = new SqliteLegacyRepoKeys(db)
    await Promise.all([keys.adopt('acme/shop', 42), keys.adopt('acme/shop', 42)])
    expect(await layoutOf('alice')).toEqual([{ table: 'users', x: 1, y: 2 }])
    expect(db.select().from(layoutsTable).all()).toHaveLength(2)
  })

  it('never looks for rows again once the database had none left at start-up', async () => {
    const keys = new SqliteLegacyRepoKeys(db)
    // Only possible by hand: RepoERD never writes a name key any more.
    saveLegacyRows()
    await keys.adopt('acme/shop', 42)
    expect(await layoutOf('alice')).toEqual([])
  })
})
