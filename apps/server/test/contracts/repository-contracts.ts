import { describe, expect, it } from 'vitest'
import type {
  LayoutRepository,
  LayoutScope,
} from '../../src/application/ports/layout-repository.js'
import type { SessionRepository } from '../../src/application/ports/session-repository.js'
import type { UserRepository } from '../../src/application/ports/user-repository.js'

/** A fresh repository in which the users `alice` and `bob` exist; `close` releases it. */
export type Factory<T> = () => Promise<{ repo: T; close: () => void }>

async function withRepo<T>(factory: Factory<T>, run: (repo: T) => Promise<void>) {
  const { repo, close } = await factory()
  try {
    await run(repo)
  } finally {
    close()
  }
}

const DAY = 24 * 3600_000

/** What every UserRepository must do: SQLite in production, the in-memory fake in HTTP tests. */
export function userRepositoryContract(name: string, factory: Factory<UserRepository>) {
  describe(`${name} (UserRepository contract)`, () => {
    it('updates profiles without touching the admin flag', () =>
      withRepo(factory, async (users) => {
        expect(await users.countAdmins()).toBe(0)
        await users.setAdmin('alice', true)
        await users.upsert({
          id: 'alice',
          login: 'alice-renamed',
          avatarUrl: 'https://a.example/1',
        })
        expect(await users.get('alice')).toEqual({
          id: 'alice',
          login: 'alice-renamed',
          avatarUrl: 'https://a.example/1',
          isAdmin: true,
        })
        expect(await users.countAdmins()).toBe(1)
        expect(await users.get('nobody')).toBeNull()
      }))

    it('promotes the first administrator only while there is none', () =>
      withRepo(factory, async (users) => {
        expect(await users.promoteFirstAdmin('nobody')).toBe(false)
        expect(await users.promoteFirstAdmin('alice')).toBe(true)
        expect(await users.promoteFirstAdmin('bob')).toBe(false)
        expect(await users.promoteFirstAdmin('alice')).toBe(false)
        expect(await users.get('bob')).toMatchObject({ isAdmin: false })
        expect(await users.countAdmins()).toBe(1)
      }))

    it('never demotes the last administrator', () =>
      withRepo(factory, async (users) => {
        await users.setAdmin('alice', true)
        await users.setAdmin('bob', true)
        expect(await users.demoteAdmin('alice')).toBe(true)
        expect(await users.demoteAdmin('bob')).toBe(false)
        expect(await users.demoteAdmin('alice')).toBe(false)
        expect((await users.listAdmins()).map((user) => user.id)).toEqual(['bob'])
      }))

    it('lists administrators by login and finds users by login, ignoring case', () =>
      withRepo(factory, async (users) => {
        await users.upsert({ id: 'carol', login: 'Carol', avatarUrl: null })
        await users.setAdmin('carol', true)
        await users.setAdmin('alice', true)
        expect((await users.listAdmins()).map((user) => user.login)).toEqual(['alice', 'Carol'])
        expect(await users.findByLogin('CAROL')).toMatchObject({ id: 'carol', isAdmin: true })
        expect(await users.findByLogin('nobody')).toBeNull()
      }))

    it('sorts administrators by the code points of their lower-cased login', () =>
      withRepo(factory, async (users) => {
        for (const login of ['aa_', 'AA-', 'Ab']) {
          await users.upsert({ id: login, login, avatarUrl: null })
          await users.setAdmin(login, true)
        }
        expect((await users.listAdmins()).map((user) => user.login)).toEqual(['AA-', 'aa_', 'Ab'])
      }))

    it('gives a GitHub login to one account only', () =>
      withRepo(factory, async (users) => {
        await users.upsert({ id: '1', login: 'Dana', avatarUrl: null })
        await users.upsert({ id: '2', login: 'dana', avatarUrl: null }) // login renamed and reused
        expect((await users.findByLogin('DANA'))?.id).toBe('2')
        expect((await users.get('1'))?.login).toBe('Dana~stale')
        await users.upsert({ id: '1', login: 'dana-new', avatarUrl: null }) // signs in again
        expect((await users.get('1'))?.login).toBe('dana-new')
        expect((await users.findByLogin('dana'))?.id).toBe('2')
      }))

    it('finds the account that holds a reused login', () =>
      withRepo(factory, async (users) => {
        await users.upsert({ id: 'old-dave', login: 'dave', avatarUrl: null })
        await users.upsert({ id: 'new-dave', login: 'Dave', avatarUrl: null })
        await users.upsert({ id: 'old-dave', login: 'dave-renamed', avatarUrl: 'https://a/o.png' })
        expect(await users.findByLogin('DAVE')).toMatchObject({ id: 'new-dave' })
      }))

    it('stores GitHub tokens, clears them, and counts the users who had some', () =>
      withRepo(factory, async (users) => {
        const tokens = {
          accessToken: 'ghu_1',
          accessTokenExpiresAt: new Date(1000),
          refreshToken: 'ghr_1',
          refreshTokenExpiresAt: new Date(2000),
        }
        expect(await users.getTokens('alice')).toBeNull()
        await users.saveTokens('alice', tokens)
        expect(await users.getTokens('alice')).toEqual(tokens)
        await users.saveTokens('bob', {
          ...tokens,
          accessTokenExpiresAt: null,
          refreshToken: null,
          refreshTokenExpiresAt: null,
        })
        expect(await users.getTokens('bob')).toMatchObject({ refreshToken: null })
        expect(await users.clearAllTokens()).toBe(2)
        expect(await users.getTokens('alice')).toBeNull()
        expect(await users.clearAllTokens()).toBe(0)
        expect(await users.get('alice')).toMatchObject({ login: 'alice' })
        await users.saveTokens('alice', tokens)
        await users.saveTokens('alice', null)
        expect(await users.getTokens('alice')).toBeNull()
      }))

    it('lists every user with their last activity, sorted by login', () =>
      withRepo(factory, async (users) => {
        await users.upsert({ id: 'carol', login: 'Carol', avatarUrl: 'https://a.example/c' })
        await users.setAdmin('bob', true)
        await users.recordActivity('alice', new Date(5_000))
        await users.recordActivity('nobody', new Date(6_000))
        expect(await users.listUsers()).toEqual([
          {
            id: 'alice',
            login: 'alice',
            avatarUrl: null,
            isAdmin: false,
            lastSeenAt: new Date(5_000),
          },
          { id: 'bob', login: 'bob', avatarUrl: null, isAdmin: true, lastSeenAt: null },
          {
            id: 'carol',
            login: 'Carol',
            avatarUrl: 'https://a.example/c',
            isAdmin: false,
            lastSeenAt: null,
          },
        ])
      }))
  })
}

export function sessionRepositoryContract(name: string, factory: Factory<SessionRepository>) {
  describe(`${name} (SessionRepository contract)`, () => {
    const now = new Date('2026-10-11T00:00:00Z')
    const at = (iso: string) => new Date(iso)
    /** Expired exactly now, live, created exactly 90 days ago, created 1 ms later. */
    const BOUNDARY_SESSIONS = [
      {
        idHash: 'expired-now',
        userId: 'alice',
        expiresAt: now,
        lastSeenAt: at('2026-10-01'),
        createdAt: at('2026-10-01'),
      },
      {
        idHash: 'live',
        userId: 'alice',
        expiresAt: at('2026-11-01'),
        lastSeenAt: at('2026-10-10'),
        createdAt: at('2026-10-01'),
      },
      {
        idHash: 'ninety-days',
        userId: 'bob',
        expiresAt: at('2026-11-01'),
        lastSeenAt: at('2026-10-10'),
        createdAt: new Date(now.getTime() - 90 * DAY),
      },
      {
        idHash: 'almost-ninety-days',
        userId: 'bob',
        expiresAt: at('2026-11-01'),
        lastSeenAt: at('2026-10-10'),
        createdAt: new Date(now.getTime() - 90 * DAY + 1),
      },
    ]

    it('creates, finds, touches and deletes sessions', () =>
      withRepo(factory, async (sessions) => {
        const session = {
          idHash: 'hash-1',
          userId: 'alice',
          expiresAt: new Date(10_000),
          lastSeenAt: new Date(1_000),
          createdAt: new Date(500),
        }
        await sessions.create(session)
        expect(await sessions.find('hash-1')).toEqual(session)
        await sessions.touch('hash-1', new Date(2_000), new Date(20_000))
        expect(await sessions.find('hash-1')).toEqual({
          ...session,
          lastSeenAt: new Date(2_000),
          expiresAt: new Date(20_000),
        })
        await sessions.delete('hash-1')
        expect(await sessions.find('hash-1')).toBeNull()
      }))

    it('deletes every session of a user, and counts them', () =>
      withRepo(factory, async (sessions) => {
        const times = {
          expiresAt: new Date(10_000),
          lastSeenAt: new Date(1_000),
          createdAt: new Date(1_000),
        }
        await sessions.create({ idHash: 'a1', userId: 'alice', ...times })
        await sessions.create({ idHash: 'a2', userId: 'alice', ...times })
        await sessions.create({ idHash: 'b1', userId: 'bob', ...times })
        expect(await sessions.deleteForUser('alice')).toBe(2)
        expect(await sessions.find('a1')).toBeNull()
        expect(await sessions.find('b1')).not.toBeNull()
      }))

    it('deletes the sessions expired or signed in 90 days ago or more, boundaries included', () =>
      withRepo(factory, async (sessions) => {
        for (const session of BOUNDARY_SESSIONS) await sessions.create(session)
        expect(await sessions.deleteExpired(now)).toBe(2)
        expect(await sessions.find('expired-now')).toBeNull()
        expect(await sessions.find('ninety-days')).toBeNull()
        expect(await sessions.find('live')).not.toBeNull()
        expect(await sessions.find('almost-ninety-days')).not.toBeNull()
      }))

    it('counts, per user, the sessions still valid at a date', () =>
      withRepo(factory, async (sessions) => {
        for (const session of BOUNDARY_SESSIONS) await sessions.create(session)
        expect(await sessions.countActiveByUser(now)).toEqual(
          new Map([
            ['alice', 1],
            ['bob', 1],
          ]),
        )
      }))

    it('deletes every session, and counts them', () =>
      withRepo(factory, async (sessions) => {
        for (const session of BOUNDARY_SESSIONS) await sessions.create(session)
        expect(await sessions.deleteAll()).toBe(4)
        expect(await sessions.find('live')).toBeNull()
        expect(await sessions.deleteAll()).toBe(0)
      }))
  })
}

export function layoutRepositoryContract(name: string, factory: Factory<LayoutRepository>) {
  describe(`${name} (LayoutRepository contract)`, () => {
    const repo = { id: 7, owner: 'Acme', name: 'Shop' }
    const scope = (
      userId: string,
      mode: LayoutScope['mode'] = 'ALL_FIELDS',
      sourceId = 'prisma/schema.prisma',
    ): LayoutScope => ({ userId, repo, sourceId, mode })

    it('upserts positions per user and never deletes other tables', () =>
      withRepo(factory, async (layouts) => {
        await layouts.upsert(scope('alice'), [
          { table: 'users', x: 1, y: 2 },
          { table: 'gone_on_this_branch', x: 3, y: 4 },
        ])
        await layouts.upsert(scope('alice'), [{ table: 'users', x: 10, y: 20 }])
        await layouts.upsert(scope('bob'), [{ table: 'users', x: 7, y: 7 }])
        // Keyed by the repository id: a renamed repository keeps its layouts.
        const alice = await layouts.get({
          ...scope('alice'),
          repo: { id: 7, owner: 'acme', name: 'shop-renamed' },
        })
        expect(alice.sort((a, b) => a.table.localeCompare(b.table))).toEqual([
          { table: 'gone_on_this_branch', x: 3, y: 4 },
          { table: 'users', x: 10, y: 20 },
        ])
        expect(await layouts.get(scope('bob'))).toEqual([{ table: 'users', x: 7, y: 7 }])
      }))

    it('lists the source and mode of each saved layout of a user in a repository', () =>
      withRepo(factory, async (layouts) => {
        await layouts.upsert(scope('alice'), [{ table: 'users', x: 1, y: 1 }])
        await layouts.upsert(scope('alice', 'TABLE_NAME'), [{ table: 'users', x: 1, y: 1 }])
        await layouts.upsert(scope('alice', 'KEYS_ONLY'), [])
        await layouts.upsert(scope('bob'), [{ table: 'users', x: 1, y: 1 }])
        const scopes = await layouts.listScopes('alice', repo)
        expect(scopes.sort((a, b) => a.mode.localeCompare(b.mode))).toEqual([
          { sourceId: 'prisma/schema.prisma', mode: 'ALL_FIELDS' },
          { sourceId: 'prisma/schema.prisma', mode: 'TABLE_NAME' },
        ])
        expect(await layouts.listScopes('alice', { id: 8, owner: 'acme', name: 'other' })).toEqual(
          [],
        )
      }))

    it('keeps display modes apart', () =>
      withRepo(factory, async (layouts) => {
        await layouts.upsert(scope('alice'), [{ table: 'users', x: 1, y: 1 }])
        await layouts.upsert(scope('alice', 'TABLE_NAME'), [{ table: 'users', x: 9, y: 9 }])
        expect(await layouts.get(scope('alice'))).toEqual([{ table: 'users', x: 1, y: 1 }])
        expect(await layouts.get(scope('alice', 'TABLE_NAME'))).toEqual([
          { table: 'users', x: 9, y: 9 },
        ])
      }))

    it('handles any character in a source id (manual source names)', () =>
      withRepo(factory, async (layouts) => {
        const odd = scope('alice', 'ALL_FIELDS', 'manual:billing|v2')
        await layouts.upsert(odd, [{ table: 'invoices', x: 1, y: 2 }])
        expect(await layouts.listScopes('alice', repo)).toEqual([
          { sourceId: 'manual:billing|v2', mode: 'ALL_FIELDS' },
        ])
        expect(await layouts.get(odd)).toEqual([{ table: 'invoices', x: 1, y: 2 }])
      }))

    it('upserts more rows than one SQL statement allows', () =>
      withRepo(factory, async (layouts) => {
        const many = Array.from({ length: 1200 }, (_, i) => ({ table: `t${i}`, x: i, y: i }))
        await layouts.upsert(scope('alice'), many)
        await layouts.upsert(scope('alice'), [{ table: 't0', x: -1, y: -1 }])
        const saved = await layouts.get(scope('alice'))
        expect(saved).toHaveLength(1200)
        expect(saved).toContainEqual({ table: 't0', x: -1, y: -1 })
      }))
  })
}
