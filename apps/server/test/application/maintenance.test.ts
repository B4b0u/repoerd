import { describe, expect, it } from 'vitest'
import { makeMaintenance } from '../../src/application/use-cases/maintenance.js'
import { FAKE_APP } from '../fakes/fake-github.js'
import {
  InMemoryInstanceConfig,
  InMemorySessionRepository,
  InMemoryUserRepository,
} from '../fakes/in-memory-stores.js'

const TOKENS = {
  accessToken: 'ghu_1',
  accessTokenExpiresAt: null,
  refreshToken: null,
  refreshTokenExpiresAt: null,
}

function world() {
  const config = new InMemoryInstanceConfig()
  config.config = {
    ...config.config,
    publicUrl: 'https://erd.example.com',
    app: FAKE_APP,
    allowedOrgs: ['acme'],
    setupCodeHash: 'hash(code)',
    setupGrant: { hash: 'hash(grant)', expiresAt: new Date(5000) },
    githubMode: 'real',
  }
  const users = new InMemoryUserRepository()
  users.users.set('1', { id: '1', login: 'Alice', avatarUrl: null, isAdmin: true })
  users.users.set('2', { id: '2', login: 'bob', avatarUrl: null, isAdmin: false })
  users.tokens.set('1', TOKENS)
  users.tokens.set('2', TOKENS)
  const sessions = new InMemorySessionRepository()
  const times = { expiresAt: new Date(10_000), lastSeenAt: new Date(0), createdAt: new Date(0) }
  sessions.sessions.set('a', { idHash: 'a', userId: '1', ...times })
  sessions.sessions.set('b', { idHash: 'b', userId: '2', ...times })
  return { config, users, sessions, maintenance: makeMaintenance({ config, users, sessions }) }
}

describe('maintenance (repoerd-admin)', () => {
  it('lists the administrators', async () => {
    expect(await world().maintenance.listAdmins()).toEqual([
      { id: '1', login: 'Alice', avatarUrl: null, isAdmin: true },
    ])
  })

  it('promotes a user who signed in once, whatever the case, the spaces or a leading @', async () => {
    const { maintenance, users } = world()
    expect(await maintenance.promote(' @BOB ')).toEqual({
      ok: true,
      value: {
        user: { id: '2', login: 'bob', avatarUrl: null, isAdmin: true },
        alreadyAdmin: false,
      },
    })
    expect(users.users.get('2')?.isAdmin).toBe(true)
    expect(await maintenance.promote('alice')).toMatchObject({
      ok: true,
      value: { alreadyAdmin: true },
    })
  })

  it('refuses a login nobody signed in with, and promotes the current holder of a reused login', async () => {
    const { maintenance, users } = world()
    await users.upsert({ id: '3', login: 'carol', avatarUrl: null })
    // Another account took "carol": account 3 is now carol~stale.
    await users.upsert({ id: '4', login: 'Carol', avatarUrl: null })
    expect(await maintenance.promote('ghost')).toEqual({
      ok: false,
      error: { kind: 'user-not-found', login: 'ghost' },
    })
    expect(await maintenance.promote('carol')).toMatchObject({
      ok: true,
      value: { user: { id: '4' } },
    })
    expect(users.users.get('3')?.isAdmin).toBe(false)
  })

  it('sets a valid public URL as its origin and refuses anything else', async () => {
    const { maintenance, config } = world()
    expect(await maintenance.setPublicUrl(' https://new.example.com/ ')).toEqual({
      ok: true,
      value: {
        publicUrl: 'https://new.example.com',
        callbackUrl: 'https://new.example.com/auth/callback',
      },
    })
    for (const input of ['new.example.com', 'https://new.example.com/repoerd', 'ftp://x.example']) {
      expect(await maintenance.setPublicUrl(input)).toEqual({
        ok: false,
        error: { kind: 'invalid-public-url', input },
      })
    }
    expect(config.config.publicUrl).toBe('https://new.example.com')
  })

  it('replaces the allowed organisations like /admin does, or removes the restriction', async () => {
    const { maintenance, config } = world()
    expect(await maintenance.setAllowedOrgs([' Beta ', 'acme', 'ACME', ''])).toEqual({
      ok: true,
      value: ['acme', 'beta'],
    })
    expect(config.config.allowedOrgs).toEqual(['acme', 'beta'])
    expect(await maintenance.setAllowedOrgs(['acme', 'not an org'])).toEqual({
      ok: false,
      error: { kind: 'invalid-organization', login: 'not an org' },
    })
    expect(config.config.allowedOrgs).toEqual(['acme', 'beta'])
    expect(await maintenance.setAllowedOrgs([])).toEqual({ ok: true, value: [] })
    expect(config.config.allowedOrgs).toEqual([])
    expect(config.config.app).toEqual(FAKE_APP)
  })

  it('forgets the App, the setup code, every GitHub token and session, and keeps the rest', async () => {
    const { maintenance, config, users, sessions } = world()
    expect(await maintenance.resetApp()).toEqual({ tokensCleared: 2, sessionsDeleted: 2 })
    expect(config.config).toEqual({
      publicUrl: 'https://erd.example.com',
      app: null,
      allowedOrgs: ['acme'],
      setupCodeHash: null,
      setupGrant: null,
      githubMode: 'real',
    })
    expect(users.tokens.size).toBe(0)
    expect(sessions.sessions.size).toBe(0)
    expect(await users.listAdmins()).toHaveLength(1)
  })
})
