import { describe, expect, it, vi } from 'vitest'
import { makeAdmin } from '../../src/application/use-cases/admin.js'
import { FAKE_APP } from '../fakes/fake-github.js'
import { InMemoryRepoDirectory } from '../fakes/in-memory-repo-directory.js'
import {
  InMemoryInstanceConfig,
  InMemorySessionRepository,
  InMemoryUserRepository,
} from '../fakes/in-memory-stores.js'

const NOW = new Date('2026-10-10T12:00:00Z')

function world() {
  const config = new InMemoryInstanceConfig()
  config.config = { ...config.config, publicUrl: 'https://erd.example.com', app: FAKE_APP }
  const users = new InMemoryUserRepository()
  users.users.set('admin', { id: 'admin', login: 'Admin', avatarUrl: null, isAdmin: true })
  users.users.set('2', { id: '2', login: 'bob', avatarUrl: null, isAdmin: false })
  const directory = new InMemoryRepoDirectory([], ['acme'])
  const sessions = new InMemorySessionRepository()
  return {
    config,
    users,
    directory,
    sessions,
    admin: makeAdmin({ config, users, directory, sessions, now: () => NOW }),
  }
}

describe('admin configuration', () => {
  it('shows the App with its settings and installation links, and the callback URL to register', async () => {
    const { admin } = world()
    expect(await admin.getConfig()).toEqual({
      version: expect.any(String),
      publicUrl: 'https://erd.example.com',
      callbackUrl: 'https://erd.example.com/auth/callback',
      allowedOrgs: [],
      app: {
        name: 'RepoERD test',
        ownerLogin: 'acme',
        htmlUrl: 'https://github.com/apps/repoerd-test',
        installUrl: 'https://github.com/apps/repoerd-test/installations/new',
        settingsUrl: 'https://github.com/settings/apps/repoerd-test',
      },
    })
  })

  it('shows no App and no callback URL in fake mode', async () => {
    const { admin, config } = world()
    config.config = { ...config.config, publicUrl: null, app: null }
    expect(await admin.getConfig()).toMatchObject({ publicUrl: null, callbackUrl: null, app: null })
  })

  it('says a stale save is stale before any GitHub read', async () => {
    const { admin, directory } = world()
    const { version } = await admin.getConfig()
    await admin.updateConfig('admin', { allowedOrgs: ['acme'], version })
    const read = vi.spyOn(directory, 'forUser')
    expect(await admin.updateConfig('admin', { allowedOrgs: ['other'], version })).toEqual({
      ok: false,
      error: { kind: 'config-changed' },
    })
    expect(read).not.toHaveBeenCalled()
  })

  it('refuses a save made on another version of the configuration', async () => {
    const { admin, config } = world()
    const { version } = await admin.getConfig()
    expect((await admin.updateConfig('admin', { allowedOrgs: ['acme'], version })).ok).toBe(true)
    expect(await admin.updateConfig('admin', { allowedOrgs: [], version })).toEqual({
      ok: false,
      error: { kind: 'config-changed' },
    })
    expect(config.config.allowedOrgs).toEqual(['acme'])
    // Without a version (an API client), the save goes through as before.
    expect((await admin.updateConfig('admin', { allowedOrgs: [] })).ok).toBe(true)
  })

  it('saves normalised organisations the administrator belongs to', async () => {
    const { admin, config } = world()
    const result = await admin.updateConfig('admin', { allowedOrgs: [' Acme ', 'acme'] })
    expect(result.ok && result.value.allowedOrgs).toEqual(['acme'])
    expect(config.config.allowedOrgs).toEqual(['acme'])
  })

  it('refuses organisations that would lock the administrator out, and invalid logins', async () => {
    const { admin, config } = world()
    expect(await admin.updateConfig('admin', { allowedOrgs: ['other'] })).toEqual({
      ok: false,
      error: { kind: 'self-lockout' },
    })
    expect(await admin.updateConfig('admin', { allowedOrgs: ['not an org'] })).toEqual({
      ok: false,
      error: { kind: 'invalid-organization', login: 'not an org' },
    })
    expect(config.config.allowedOrgs).toEqual([])
  })

  it('asks for a new sign-in when the administrator GitHub authorisation is gone', async () => {
    const { admin, directory } = world()
    directory.snapshot = null
    expect(await admin.updateConfig('admin', { allowedOrgs: ['acme'] })).toEqual({
      ok: false,
      error: { kind: 'reauth-required' },
    })
    // Removing the restriction never needs GitHub.
    expect((await admin.updateConfig('admin', { allowedOrgs: [] })).ok).toBe(true)
  })

  it('checks the fresh GitHub list, not the cached one, before saving', async () => {
    const { admin, config, directory } = world()
    // The cached list still shows the administrator in acme; GitHub no longer does.
    directory.staleByUser.set('admin', { accounts: ['acme'], repos: [] })
    directory.byUser.set('admin', { accounts: ['other'], repos: [] })
    expect(await admin.updateConfig('admin', { allowedOrgs: ['acme'] })).toEqual({
      ok: false,
      error: { kind: 'self-lockout' },
    })
    expect(config.config.allowedOrgs).toEqual([])
  })

  it('checks the access of the administrator who saves, not of anyone else', async () => {
    const { admin, config, users, directory } = world()
    users.users.set('carol', { id: 'carol', login: 'carol', avatarUrl: null, isAdmin: true })
    directory.byUser.set('carol', { accounts: ['other'], repos: [] })
    expect(await admin.updateConfig('carol', { allowedOrgs: ['acme'] })).toEqual({
      ok: false,
      error: { kind: 'self-lockout' },
    })
    expect(config.config.allowedOrgs).toEqual([])
    expect((await admin.updateConfig('admin', { allowedOrgs: ['acme'] })).ok).toBe(true)
  })

  it('refuses a new public URL while the saved organisations would lock the administrator out', async () => {
    const { admin, config, directory } = world()
    config.config = { ...config.config, allowedOrgs: ['acme'] }
    const input = { allowedOrgs: ['acme'], publicUrl: 'https://new.example.com' }

    directory.snapshot = { accounts: ['other'], repos: [] }
    expect(await admin.updateConfig('admin', input)).toEqual({
      ok: false,
      error: { kind: 'self-lockout' },
    })
    directory.snapshot = null
    expect(await admin.updateConfig('admin', input)).toEqual({
      ok: false,
      error: { kind: 'reauth-required' },
    })
    expect(config.config.publicUrl).toBe('https://erd.example.com')
  })

  it('changes the public URL, validated like at setup', async () => {
    const { admin, config } = world()
    const result = await admin.updateConfig('admin', {
      allowedOrgs: [],
      publicUrl: 'https://new.example.com/',
    })
    expect(result.ok && result.value.callbackUrl).toBe('https://new.example.com/auth/callback')
    expect(config.config.publicUrl).toBe('https://new.example.com')
    expect(
      await admin.updateConfig('admin', {
        allowedOrgs: [],
        publicUrl: 'https://new.example.com/path',
      }),
    ).toEqual({
      ok: false,
      error: { kind: 'invalid-public-url' },
    })
  })
})

describe('administrators', () => {
  it('adds a user who signed in once, by login, ignoring case', async () => {
    const { admin } = world()
    const added = await admin.addAdmin(' BOB ')
    expect(added.ok && added.value.map((user) => user.login)).toEqual(['Admin', 'bob'])
    expect(await admin.addAdmin('nobody')).toEqual({ ok: false, error: { kind: 'user-not-found' } })
  })

  it('removes administrators but never the last one', async () => {
    const { admin } = world()
    expect(await admin.removeAdmin('admin')).toEqual({ ok: false, error: { kind: 'last-admin' } })
    await admin.addAdmin('bob')
    const removed = await admin.removeAdmin('admin')
    expect(removed.ok && removed.value.map((user) => user.id)).toEqual(['2'])
    expect(await admin.removeAdmin('admin')).toEqual({
      ok: false,
      error: { kind: 'not-admin' },
    })
    expect(await admin.removeAdmin('nobody')).toEqual({
      ok: false,
      error: { kind: 'user-not-found' },
    })
  })

  it('tells apart a user who is not an administrator from one who never signed in', async () => {
    const { admin } = world()
    expect(await admin.removeAdmin('2')).toEqual({ ok: false, error: { kind: 'not-admin' } })
  })

  it('answers not-admin to the second of two concurrent removals of the same administrator', async () => {
    const { admin } = world()
    await admin.addAdmin('bob')
    const [first, second] = await Promise.all([
      admin.removeAdmin('admin'),
      admin.removeAdmin('admin'),
    ])
    expect(first.ok && first.value.map((user) => user.id)).toEqual(['2'])
    expect(second).toEqual({ ok: false, error: { kind: 'not-admin' } })
  })
})

describe('users', () => {
  it('lists every user with their former login, last activity and valid sessions', async () => {
    const { admin, users, sessions } = world()
    // bob renamed his GitHub account; another account now holds "bob".
    await users.upsert({ id: '3', login: 'bob', avatarUrl: null })
    await users.recordActivity('admin', new Date('2026-10-09T08:00:00Z'))
    const times = { lastSeenAt: NOW, createdAt: NOW }
    await sessions.create({
      idHash: 'live',
      userId: 'admin',
      expiresAt: new Date('2026-10-20T00:00:00Z'),
      ...times,
    })
    await sessions.create({
      idHash: 'expired',
      userId: '2',
      expiresAt: new Date('2026-10-01T00:00:00Z'),
      ...times,
    })
    await sessions.create({
      idHash: 'too-old',
      userId: '2',
      expiresAt: new Date('2026-12-01T00:00:00Z'),
      lastSeenAt: NOW,
      createdAt: new Date('2026-07-01T00:00:00Z'),
    })

    expect(await admin.listUsers()).toEqual([
      {
        id: 'admin',
        login: 'Admin',
        stale: false,
        avatarUrl: null,
        isAdmin: true,
        lastSeenAt: new Date('2026-10-09T08:00:00Z'),
        activeSessions: 1,
      },
      {
        id: '3',
        login: 'bob',
        stale: false,
        avatarUrl: null,
        isAdmin: false,
        lastSeenAt: null,
        activeSessions: 0,
      },
      {
        id: '2',
        login: 'bob',
        stale: true,
        avatarUrl: null,
        isAdmin: false,
        lastSeenAt: null,
        activeSessions: 0,
      },
    ])
  })

  it('signs one user out everywhere and refuses an unknown user', async () => {
    const { admin, sessions } = world()
    const session = { expiresAt: new Date('2026-10-20T00:00:00Z'), lastSeenAt: NOW, createdAt: NOW }
    await sessions.create({ idHash: 'b1', userId: '2', ...session })
    await sessions.create({ idHash: 'b2', userId: '2', ...session })
    await sessions.create({ idHash: 'a', userId: 'admin', ...session })

    const result = await admin.signOutEverywhere('2')
    expect(result.ok && result.value.find((user) => user.id === '2')?.activeSessions).toBe(0)
    expect([...sessions.sessions.keys()]).toEqual(['a'])
    expect(await admin.signOutEverywhere('nobody')).toEqual({
      ok: false,
      error: { kind: 'user-not-found' },
    })
  })
})
