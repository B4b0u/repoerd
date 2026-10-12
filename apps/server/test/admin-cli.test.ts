import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_DATABASE_PATH,
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_USAGE,
  runAdminCli,
  USAGE,
} from '../src/admin-cli.js'
import { makeSetup } from '../src/application/use-cases/setup.js'
import { ConfigError, loadConfig } from '../src/config.js'
import { createSecretBox } from '../src/infrastructure/crypto/secret-box.js'
import { nodeTokenService } from '../src/infrastructure/crypto/tokens.js'
import { type AppDatabase, openDatabase } from '../src/infrastructure/persistence/database.js'
import { SqliteInstanceConfigRepository } from '../src/infrastructure/persistence/sqlite-instance-config-repository.js'
import { SqliteLayoutRepository } from '../src/infrastructure/persistence/sqlite-layout-repository.js'
import { SqliteSessionRepository } from '../src/infrastructure/persistence/sqlite-session-repository.js'
import { SqliteUserRepository } from '../src/infrastructure/persistence/sqlite-user-repository.js'
import {
  checkStoredSecrets,
  claimInstanceMode,
  forgetAccessWithoutApp,
  SECRET_KEY_MISMATCH,
  StartupError,
} from '../src/startup-checks.js'
import { FAKE_APP, FakeAppRegistrar } from './fakes/fake-github.js'

const KEY = 'Kq3vR8wZt1Yp6Nf2Lh9Xc4Bj7Md0Gs5A'
const TOKENS = {
  accessToken: 'ghu_1',
  accessTokenExpiresAt: null,
  refreshToken: 'ghr_1',
  refreshTokenExpiresAt: null,
}
const SCOPE = {
  userId: '1',
  repo: { id: 42, owner: 'acme', name: 'shop' },
  sourceId: 'prisma/schema.prisma',
  mode: 'ALL_FIELDS' as const,
}
let workDir: string | undefined

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true })
  workDir = undefined
})

/** A database file as a real instance left it: App and tokens sealed with `key`, sessions, a layout. */
async function realInstance(key = KEY): Promise<string> {
  workDir = mkdtempSync(path.join(tmpdir(), 'repoerd-cli-'))
  const file = path.join(workDir, 'repoerd.sqlite')
  const { db, close } = openDatabase(file)
  try {
    const box = createSecretBox(key)
    await new SqliteInstanceConfigRepository(db, box).update({
      publicUrl: 'https://erd.example.com',
      app: FAKE_APP,
      allowedOrgs: ['acme'],
      githubMode: 'real',
    })
    const users = new SqliteUserRepository(db, box)
    await users.upsert({ id: '1', login: 'alice', avatarUrl: null })
    await users.setAdmin('1', true)
    await users.upsert({ id: '2', login: 'bob', avatarUrl: null })
    await users.saveTokens('1', TOKENS)
    await users.saveTokens('2', TOKENS)
    const sessions = new SqliteSessionRepository(db)
    const times = {
      expiresAt: new Date('2099-01-01'),
      lastSeenAt: new Date(),
      createdAt: new Date(),
    }
    await sessions.create({ idHash: 'a', userId: '1', ...times })
    await sessions.create({ idHash: 'b', userId: '2', ...times })
    await new SqliteLayoutRepository(db).upsert(SCOPE, [{ table: 'users', x: 1, y: 2 }])
  } finally {
    close()
  }
  return file
}

async function cli(argv: string[], env: Record<string, string | undefined>) {
  const out: string[] = []
  const err: string[] = []
  const code = await runAdminCli(argv, env, {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

/** Opens the file again (as the restarted server would) and closes it afterwards. */
async function withDatabase<T>(file: string, read: (db: AppDatabase) => Promise<T>): Promise<T> {
  const { db, close } = openDatabase(file)
  try {
    return await read(db)
  } finally {
    close()
  }
}

describe('repoerd-admin', () => {
  it('prints its usage, and refuses unknown commands and wrong arguments with code 2', async () => {
    expect(await cli(['--help'], {})).toEqual({ code: EXIT_OK, out: USAGE, err: '' })
    for (const argv of [
      [],
      ['nope'],
      ['constructor'],
      ['promote'],
      ['list-admins', 'extra'],
      ['set-public-url', 'a', 'b'],
      ['reset-app', 'now'],
    ]) {
      const result = await cli(argv, {})
      expect(result.code).toBe(EXIT_USAGE)
      expect(result.err).toContain('Usage: repoerd-admin <command>')
    }
  })

  it('prints the usage for --help or -h in any position, writing nothing', async () => {
    const file = await realInstance()
    const before = readFileSync(file)
    expect(await cli(['promote', '--help'], { DATABASE_PATH: file })).toEqual({
      code: EXIT_OK,
      out: USAGE,
      err: '',
    })
    expect((await cli(['reset-app', '-h'], { DATABASE_PATH: file })).code).toBe(EXIT_OK)
    expect(readFileSync(file).equals(before)).toBe(true)
    expect(
      await withDatabase(file, (db) => new SqliteSessionRepository(db).find('a')),
    ).not.toBeNull()
  })

  it('refuses a file that is not a RepoERD database, leaving it byte-identical', async () => {
    workDir = mkdtempSync(path.join(tmpdir(), 'repoerd-cli-'))
    const empty = path.join(workDir, 'empty.sqlite')
    writeFileSync(empty, '')
    const other = path.join(workDir, 'other.sqlite')
    const sqlite = new Database(other)
    sqlite.exec('CREATE TABLE notes (id INTEGER)')
    sqlite.close()
    const text = path.join(workDir, 'text.sqlite')
    writeFileSync(text, 'this is not sqlite at all, but long enough to look like a file'.repeat(5))
    for (const file of [empty, other, text]) {
      const before = readFileSync(file)
      const result = await cli(['reset-app'], { DATABASE_PATH: file })
      expect(result).toEqual({
        code: EXIT_FAILURE,
        out: '',
        err: `${file} is not a RepoERD database`,
      })
      expect(readFileSync(file).equals(before)).toBe(true)
    }
    expect(readFileSync(empty).length).toBe(0)
    expect(existsSync(`${empty}-wal`)).toBe(false)
  })

  it('wraps a failure to open the path, such as a directory', async () => {
    workDir = mkdtempSync(path.join(tmpdir(), 'repoerd-cli-'))
    const dir = path.join(workDir, 'folder.sqlite')
    mkdirSync(dir)
    const result = await cli(['list-admins'], { DATABASE_PATH: dir })
    expect(result.code).toBe(EXIT_FAILURE)
    expect(result.err).toContain(`Cannot open the database at ${dir}: `)
  })

  it('refuses a database file that does not exist, and creates none', async () => {
    workDir = mkdtempSync(path.join(tmpdir(), 'repoerd-cli-'))
    const missing = path.join(workDir, 'data', 'repoerd.sqlite')
    const result = await cli(['list-admins'], { DATABASE_PATH: missing })
    expect(result.code).toBe(EXIT_FAILURE)
    expect(result.err).toContain(`No database at ${missing}`)
    expect(existsSync(path.dirname(missing))).toBe(false)
    // Without DATABASE_PATH the Docker image path is used (never run against the host here).
    expect(DEFAULT_DATABASE_PATH).toBe('/data/repoerd.sqlite')
  })

  it('lists, promotes and moves the public URL without SECRET_KEY, never touching the mode', async () => {
    const file = await realInstance()
    const env = { DATABASE_PATH: file }
    expect(await cli(['list-admins'], env)).toEqual({ code: EXIT_OK, out: 'alice (id 1)', err: '' })
    expect(await cli(['promote', '@Bob'], env)).toEqual({
      code: EXIT_OK,
      out: 'bob is now an administrator (effective immediately).',
      err: '',
    })
    expect((await cli(['promote', 'bob'], env)).out).toBe('bob is already an administrator.')
    expect(await cli(['promote', 'ghost'], env)).toEqual({
      code: EXIT_FAILURE,
      out: '',
      err: 'Nobody signed in to RepoERD as "ghost" yet: they must sign in once first.',
    })

    const moved = await cli(['set-public-url', 'https://new.example.com/'], env)
    expect(moved.code).toBe(EXIT_OK)
    expect(moved.out).toContain('Public URL set to https://new.example.com.')
    expect(moved.out).toContain('https://new.example.com/auth/callback')
    expect(moved.out).toContain('Restart the container to apply')
    const refused = await cli(['set-public-url', 'erd.example.com/path'], env)
    expect(refused.code).toBe(EXIT_FAILURE)
    expect(refused.err).toContain('is not a valid public URL')

    await withDatabase(file, async (db) => {
      const box = createSecretBox(KEY)
      expect(await new SqliteInstanceConfigRepository(db, box).get()).toMatchObject({
        publicUrl: 'https://new.example.com',
        app: FAKE_APP,
        githubMode: 'real',
      })
      const admins = await new SqliteUserRepository(db, box).listAdmins()
      expect(admins.map((admin) => admin.login)).toEqual(['alice', 'bob'])
    })
  })

  it('shows the former login of an administrator whose GitHub login was taken', async () => {
    const file = await realInstance()
    await withDatabase(file, (db) =>
      new SqliteUserRepository(db, createSecretBox(KEY)).upsert({
        id: '9',
        login: 'alice',
        avatarUrl: null,
      }),
    )
    expect((await cli(['list-admins'], { DATABASE_PATH: file })).out).toBe(
      'alice (former login: the account was renamed on GitHub; id 1)',
    )
  })

  it('replaces or removes the allowed organisations, refusing an invalid login without writing', async () => {
    const file = await realInstance()
    const env = { DATABASE_PATH: file }
    const set = await cli(['set-allowed-orgs', 'Acme', 'beta', 'acme'], env)
    expect(set.code).toBe(EXIT_OK)
    expect(set.out).toContain('Sign-in is now restricted to: acme, beta.')
    expect(set.out).toContain('Restart the container to apply')
    const refused = await cli(['set-allowed-orgs', 'acme', 'acme/evil'], env)
    expect(refused).toEqual({
      code: EXIT_FAILURE,
      out: '',
      err: '"acme/evil" is not a valid GitHub organisation name: nothing was changed.',
    })
    const readOrgs = () =>
      withDatabase(
        file,
        async (db) =>
          (await new SqliteInstanceConfigRepository(db, createSecretBox(KEY)).get()).allowedOrgs,
      )
    expect(await readOrgs()).toEqual(['acme', 'beta'])

    const lifted = await cli(['set-allowed-orgs'], env)
    expect(lifted.code).toBe(EXIT_OK)
    expect(lifted.out).toContain('The sign-in restriction is removed')
    expect(await readOrgs()).toEqual([])
  })

  it('runs next to a server holding the database open, and a promotion is seen at once', async () => {
    const file = await realInstance()
    const server = openDatabase(file)
    try {
      const users = new SqliteUserRepository(server.db, createSecretBox(KEY))
      expect((await users.get('2'))?.isAdmin).toBe(false)
      expect((await cli(['promote', 'bob'], { DATABASE_PATH: file })).code).toBe(EXIT_OK)
      expect((await users.get('2'))?.isAdmin).toBe(true)
    } finally {
      server.close()
    }
  })

  it('never records a mode in a database that has none yet', async () => {
    workDir = mkdtempSync(path.join(tmpdir(), 'repoerd-cli-'))
    const file = path.join(workDir, 'repoerd.sqlite')
    openDatabase(file).close()
    expect(
      (await cli(['set-public-url', 'https://erd.example.com'], { DATABASE_PATH: file })).code,
    ).toBe(EXIT_OK)
    await withDatabase(file, async (db) => {
      const config = new SqliteInstanceConfigRepository(db, createSecretBox(KEY))
      expect((await config.get()).githubMode).toBeNull()
      // A demo start is still possible on this database.
      await expect(claimInstanceMode(config, 'fake')).resolves.toBeUndefined()
    })
  })

  it('resets the App, keeping layouts and administrators', async () => {
    const file = await realInstance()
    const reset = await cli(['reset-app'], { DATABASE_PATH: file })
    expect(reset.code).toBe(EXIT_OK)
    expect(reset.out).toContain(
      'GitHub App forgotten, with the GitHub tokens of 2 users and 2 sessions.',
    )
    expect(reset.out).toContain('Restart the container to apply')
    expect(reset.out).toContain('open /setup')
    const again = await cli(['reset-app'], { DATABASE_PATH: file })
    expect(again.out).toContain('with the GitHub tokens of 0 users and 0 sessions.')
    await withDatabase(file, async (db) => {
      const box = createSecretBox(KEY)
      expect(await new SqliteInstanceConfigRepository(db, box).get()).toMatchObject({
        app: null,
        publicUrl: 'https://erd.example.com',
        githubMode: 'real',
      })
      expect(await new SqliteUserRepository(db, box).getTokens('1')).toBeNull()
      expect(await new SqliteSessionRepository(db).find('a')).toBeNull()
      expect(await new SqliteLayoutRepository(db).get(SCOPE)).toEqual([
        { table: 'users', x: 1, y: 2 },
      ])
    })
  })
})

describe('recovering an instance whose SECRET_KEY must change', () => {
  it('a refused key, a new key, reset-app, a restart and a new App: everything else is kept', async () => {
    const published = 'demo-only-secret-key-0123456789abcdef'
    const newKey = 'Zt1Yp6Nf2Lh9Xc4Bj7Md0Gs5AKq3vR8w'
    const file = await realInstance(published)

    // The server refuses the published key, and the new key cannot open the stored secrets.
    expect(() => loadConfig({ SECRET_KEY: published, DATABASE_PATH: file })).toThrow(ConfigError)
    await withDatabase(file, async (db) => {
      const config = new SqliteInstanceConfigRepository(db, createSecretBox(newKey))
      await expect(checkStoredSecrets(config)).rejects.toThrow(
        new StartupError(SECRET_KEY_MISMATCH),
      )
    })

    // docker compose run --rm repoerd repoerd-admin reset-app, with the new key in the environment.
    const reset = await cli(['reset-app'], { DATABASE_PATH: file, SECRET_KEY: newKey })
    expect(reset.code).toBe(EXIT_OK)

    // The restart with the new key: every start-up check passes.
    expect(loadConfig({ SECRET_KEY: newKey, DATABASE_PATH: file }).secretKey).toBe(newKey)
    await withDatabase(file, async (db) => {
      const box = createSecretBox(newKey)
      const config = new SqliteInstanceConfigRepository(db, box)
      const users = new SqliteUserRepository(db, box)
      const sessions = new SqliteSessionRepository(db)
      await checkStoredSecrets(config)
      await claimInstanceMode(config, 'real')
      expect(await forgetAccessWithoutApp({ config, users, sessions })).toEqual({
        tokensCleared: 0,
        sessionsDeleted: 0,
      })
      expect(await config.get()).toMatchObject({
        publicUrl: 'https://erd.example.com',
        app: null,
        allowedOrgs: ['acme'],
        githubMode: 'real',
      })
      expect(await users.getTokens('1')).toBeNull()
      expect(await sessions.find('a')).toBeNull()
      expect(await new SqliteLayoutRepository(db).get(SCOPE)).toEqual([
        { table: 'users', x: 1, y: 2 },
      ])

      // A new setup code, then the App: ready at once, the administrators are still there.
      const setup = makeSetup({
        config,
        users,
        tokens: nodeTokenService,
        registrar: new FakeAppRegistrar(),
        now: () => new Date(),
      })
      const code = await setup.issueCode()
      expect(code).not.toBeNull()
      const unlocked = await setup.unlock(code ?? '')
      if (!unlocked.ok) throw new Error('The new setup code was refused')
      expect(
        await setup.saveExistingApp({
          grant: unlocked.value.grant,
          publicUrl: 'https://erd.example.com',
          appId: 42,
          clientId: 'Iv1.client',
          clientSecret: 'new-secret',
          privateKey: 'new-pem',
        }),
      ).toEqual({ ok: true, value: undefined })
      expect((await setup.status()).state).toBe('ready')
      expect(await users.listAdmins()).toMatchObject([{ id: '1', login: 'alice' }])
    })
  })

  it('signs out users who signed in through the old App while the server kept running', async () => {
    const file = await realInstance()
    // The "server": its own connection on the same file, opened before the command.
    const server = openDatabase(file)
    try {
      const box = createSecretBox(KEY)
      const serverUsers = new SqliteUserRepository(server.db, box)
      const serverSessions = new SqliteSessionRepository(server.db)
      expect((await cli(['reset-app'], { DATABASE_PATH: file })).code).toBe(EXIT_OK)
      // Between the command and the restart, the old process still signs somebody in.
      await serverUsers.saveTokens('2', TOKENS)
      await serverSessions.create({
        idHash: 'late',
        userId: '2',
        expiresAt: new Date('2099-01-01'),
        lastSeenAt: new Date(),
        createdAt: new Date(),
      })
      expect(await serverSessions.find('late')).not.toBeNull()
    } finally {
      server.close()
    }
    await withDatabase(file, async (db) => {
      const box = createSecretBox(KEY)
      const config = new SqliteInstanceConfigRepository(db, box)
      const users = new SqliteUserRepository(db, box)
      const sessions = new SqliteSessionRepository(db)
      expect(await forgetAccessWithoutApp({ config, users, sessions })).toEqual({
        tokensCleared: 1,
        sessionsDeleted: 1,
      })
      expect(await users.getTokens('2')).toBeNull()
      expect(await sessions.find('late')).toBeNull()
    })
  })
})
