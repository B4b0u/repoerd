import { describe, expect, it } from 'vitest'
import type { OAuthTokens } from '../../src/application/ports/github-identity.js'
import { makeAuth, makeUserAccessToken } from '../../src/application/use-cases/auth.js'
import { FAKE_APP, FakeGitHubIdentity } from '../fakes/fake-github.js'
import { FakeTokenService } from '../fakes/fake-tokens.js'
import {
  InMemoryInstanceConfig,
  InMemorySessionRepository,
  InMemoryUserRepository,
} from '../fakes/in-memory-stores.js'

const NOW = new Date('2026-10-10T12:00:00Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const after = (ms: number) => new Date(NOW.getTime() + ms)
const TOKENS: OAuthTokens = {
  accessToken: 'ghu_1',
  accessTokenExpiresAt: after(8 * HOUR),
  refreshToken: 'ghr_1',
  refreshTokenExpiresAt: after(180 * DAY),
}

function world() {
  const config = new InMemoryInstanceConfig()
  config.config = { ...config.config, publicUrl: 'https://erd.example.com', app: FAKE_APP }
  const users = new InMemoryUserRepository()
  const sessions = new InMemorySessionRepository()
  const identity = new FakeGitHubIdentity()
  identity.codes.set('code-1', TOKENS)
  const tokens = new FakeTokenService()
  let clock = NOW
  const now = () => clock
  const auth = makeAuth({ config, users, sessions, identity, tokens, now })
  const accessToken = makeUserAccessToken({ config, users, sessions, identity, now })
  return {
    config,
    users,
    sessions,
    identity,
    auth,
    accessToken,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms)
    },
  }
}

describe('sign-in', () => {
  it('sends the user to GitHub with the callback of the public URL', async () => {
    const { auth, config } = world()
    const started = await auth.beginSignIn('st')
    expect(started.ok && started.value.url).toContain(
      'redirect_uri=https%3A%2F%2Ferd.example.com%2Fauth%2Fcallback',
    )
    expect(started.ok && started.value.url).toContain('state=st')

    config.config = { ...config.config, app: null }
    expect(await auth.beginSignIn('st')).toEqual({ ok: false, error: { kind: 'not-configured' } })
  })

  it('creates a session and stores the GitHub tokens', async () => {
    const { auth, users, sessions } = world()
    expect(await auth.completeSignIn({ code: 'code-1' })).toEqual({
      ok: true,
      value: {
        session: 'token-1',
        expiresAt: after(30 * DAY),
        user: { id: '1', login: 'alice', avatarUrl: null, isAdmin: false },
      },
    })
    expect(sessions.sessions.get('hash(token-1)')).toMatchObject({
      userId: '1',
      expiresAt: after(30 * DAY),
    })
    expect(users.tokens.get('1')).toEqual(TOKENS)
  })

  it('rejects codes GitHub refuses', async () => {
    const { auth } = world()
    expect(await auth.completeSignIn({ code: 'unknown' })).toEqual({
      ok: false,
      error: { kind: 'invalid-code' },
    })
  })

  it('only lets members of the allowed organisations in', async () => {
    const { auth, config, identity, users } = world()
    config.config = { ...config.config, allowedOrgs: ['acme'] }
    identity.accounts = ['someone-else']
    expect(await auth.completeSignIn({ code: 'code-1' })).toEqual({
      ok: false,
      error: { kind: 'org-not-allowed' },
    })
    expect(users.users.size).toBe(0)

    identity.accounts = ['ACME']
    identity.codes.set('code-2', TOKENS)
    expect((await auth.completeSignIn({ code: 'code-2' })).ok).toBe(true)
  })

  it('makes the first user administrator only with a valid setup grant', async () => {
    const { auth, config, identity } = world()
    config.config = {
      ...config.config,
      setupGrant: { hash: 'hash(grant-1)', expiresAt: after(HOUR) },
      setupCodeHash: 'hash(CODE)',
    }

    const withoutGrant = await auth.completeSignIn({ code: 'code-1' })
    expect(withoutGrant.ok && withoutGrant.value.user.isAdmin).toBe(false)

    identity.codes.set('code-2', TOKENS)
    const withGrant = await auth.completeSignIn({ code: 'code-2', setupGrant: 'grant-1' })
    expect(withGrant.ok && withGrant.value.user.isAdmin).toBe(true)
    expect(config.config).toMatchObject({ setupGrant: null, setupCodeHash: null })

    identity.profile = { id: '2', login: 'bob', avatarUrl: null }
    identity.codes.set('code-3', TOKENS)
    const second = await auth.completeSignIn({ code: 'code-3', setupGrant: 'grant-1' })
    expect(second.ok && second.value.user.isAdmin).toBe(false)
  })

  it('does not make an administrator with an expired setup grant', async () => {
    const { auth, config, advance } = world()
    config.config = {
      ...config.config,
      setupGrant: { hash: 'hash(grant-1)', expiresAt: after(HOUR) },
      setupCodeHash: 'hash(CODE)',
    }
    advance(HOUR)
    const signedIn = await auth.completeSignIn({ code: 'code-1', setupGrant: 'grant-1' })
    expect(signedIn.ok && signedIn.value.user.isAdmin).toBe(false)
    expect(config.config.setupCodeHash).toBe('hash(CODE)')
  })

  it('makes only one administrator when two browsers sign in with the grant at once', async () => {
    const { auth, config, identity, users } = world()
    config.config = {
      ...config.config,
      setupGrant: { hash: 'hash(grant-1)', expiresAt: after(HOUR) },
      setupCodeHash: 'hash(CODE)',
    }
    identity.codes.set('code-2', { ...TOKENS, accessToken: 'ghu_bob' })
    identity.profiles.set('ghu_bob', { id: '2', login: 'bob', avatarUrl: null })

    const results = await Promise.all([
      auth.completeSignIn({ code: 'code-1', setupGrant: 'grant-1' }),
      auth.completeSignIn({ code: 'code-2', setupGrant: 'grant-1' }),
    ])
    expect(results.filter((r) => r.ok && r.value.user.isAdmin)).toHaveLength(1)
    expect(await users.countAdmins()).toBe(1)
    expect(config.config).toMatchObject({ setupGrant: null, setupCodeHash: null })
  })
})

describe('sessions', () => {
  it('resolve to their user, renew once a day and expire after 30 idle days', async () => {
    const { auth, advance, sessions } = world()
    const signedIn = await auth.completeSignIn({ code: 'code-1' })
    const token = signedIn.ok ? signedIn.value.session : ''

    expect(await auth.resolveSession(token)).toEqual({
      user: { id: '1', login: 'alice', avatarUrl: null, isAdmin: false },
      renewedExpiresAt: null,
    })
    advance(25 * HOUR)
    expect((await auth.resolveSession(token))?.renewedExpiresAt).toEqual(
      after(25 * HOUR + 30 * DAY),
    )
    expect((await auth.resolveSession(token))?.renewedExpiresAt).toBeNull()

    advance(31 * DAY)
    expect(await auth.resolveSession(token)).toBeNull()
    expect(sessions.sessions.size).toBe(0)
  })

  it('record the sign-in and the daily renewals as the last activity of the user', async () => {
    const { auth, advance, users } = world()
    const signedIn = await auth.completeSignIn({ code: 'code-1' })
    const token = signedIn.ok ? signedIn.value.session : ''
    expect(users.lastSeen.get('1')).toEqual(NOW)
    advance(2 * HOUR)
    await auth.resolveSession(token)
    expect(users.lastSeen.get('1')).toEqual(NOW)
    advance(DAY)
    await auth.resolveSession(token)
    expect(users.lastSeen.get('1')).toEqual(after(2 * HOUR + DAY))
  })

  it('end 90 days after the sign-in, even when used every day', async () => {
    const { auth, advance, sessions } = world()
    const signedIn = await auth.completeSignIn({ code: 'code-1' })
    const token = signedIn.ok ? signedIn.value.session : ''
    for (let day = 1; day < 90; day++) {
      advance(DAY)
      expect(await auth.resolveSession(token)).not.toBeNull()
    }
    // The last renewals stop at the 90th day after the sign-in.
    expect([...sessions.sessions.values()][0]?.expiresAt).toEqual(after(90 * DAY))
    advance(DAY)
    expect(await auth.resolveSession(token)).toBeNull()
    expect(sessions.sessions.size).toBe(0)
  })

  it('refuse a session signed in over 90 days ago, whatever its stored expiry', async () => {
    const { auth, users, sessions } = world()
    await users.upsert({ id: '1', login: 'alice', avatarUrl: null })
    await sessions.create({
      idHash: 'hash(old)',
      userId: '1',
      expiresAt: after(20 * DAY),
      lastSeenAt: NOW,
      createdAt: after(-90 * DAY),
    })
    expect(await auth.resolveSession('old')).toBeNull()
    expect(sessions.sessions.size).toBe(0)
  })

  it('are deleted when their user no longer exists', async () => {
    const { auth, users, sessions } = world()
    const signedIn = await auth.completeSignIn({ code: 'code-1' })
    const token = signedIn.ok ? signedIn.value.session : ''
    users.users.delete('1')

    expect(await auth.resolveSession(token)).toBeNull()
    expect(sessions.sessions.size).toBe(0)
  })

  it('ignore missing and unknown tokens, and end at sign-out', async () => {
    const { auth } = world()
    expect(await auth.resolveSession(undefined)).toBeNull()
    expect(await auth.resolveSession('forged')).toBeNull()

    const signedIn = await auth.completeSignIn({ code: 'code-1' })
    const token = signedIn.ok ? signedIn.value.session : ''
    await auth.signOut(token)
    expect(await auth.resolveSession(token)).toBeNull()
  })
})

describe('user access token', () => {
  it('is used as is while it is valid for more than 5 minutes', async () => {
    const { accessToken, users, identity } = world()
    await users.saveTokens('1', TOKENS)
    expect(await accessToken('1')).toBe('ghu_1')
    expect(identity.calls.refresh).toBe(0)
  })

  it('is refreshed when it expires soon, and the new pair is stored', async () => {
    const { accessToken, users, identity } = world()
    const fresh = { ...TOKENS, accessToken: 'ghu_2', refreshToken: 'ghr_2' }
    await users.saveTokens('1', { ...TOKENS, accessTokenExpiresAt: after(2 * MINUTE) })
    identity.refreshes.set('ghr_1', fresh)
    expect(await accessToken('1')).toBe('ghu_2')
    expect(users.tokens.get('1')).toEqual(fresh)
  })

  it('needs a new sign-in when GitHub refuses the refresh or it expired', async () => {
    const { accessToken, users } = world()
    await users.saveTokens('1', { ...TOKENS, accessTokenExpiresAt: after(MINUTE) })
    expect(await accessToken('1')).toBeNull()
    expect(users.tokens.has('1')).toBe(false)

    await users.saveTokens('1', {
      ...TOKENS,
      accessTokenExpiresAt: after(-HOUR),
      refreshTokenExpiresAt: after(-MINUTE),
    })
    expect(await accessToken('1')).toBeNull()
    expect(await accessToken('nobody')).toBeNull()
  })

  it('signs the user out everywhere when GitHub refuses the refresh', async () => {
    const { accessToken, users, sessions } = world()
    await users.saveTokens('1', { ...TOKENS, accessTokenExpiresAt: after(MINUTE) })
    const session = { expiresAt: after(DAY), lastSeenAt: NOW, createdAt: NOW }
    await sessions.create({ idHash: 'a', userId: '1', ...session })
    await sessions.create({ idHash: 'b', userId: '1', ...session })
    await sessions.create({ idHash: 'other', userId: '2', ...session })

    expect(await accessToken('1')).toBeNull()
    expect([...sessions.sessions.keys()]).toEqual(['other'])
  })

  it('is refreshed again after a refresh that failed, keeping the stored tokens', async () => {
    const { accessToken, users, identity, sessions } = world()
    const stored = { ...TOKENS, accessTokenExpiresAt: after(MINUTE) }
    await users.saveTokens('1', stored)
    await sessions.create({
      idHash: 'a',
      userId: '1',
      expiresAt: after(DAY),
      lastSeenAt: NOW,
      createdAt: NOW,
    })
    identity.refreshes.set('ghr_1', { ...TOKENS, accessToken: 'ghu_2', refreshToken: 'ghr_2' })
    const refresh = identity.refresh.bind(identity)
    let failures = 1
    identity.refresh = async (app, refreshToken) => {
      if (failures-- > 0) throw new Error('GitHub is unreachable')
      return refresh(app, refreshToken)
    }

    await expect(accessToken('1')).rejects.toThrow('GitHub is unreachable')
    expect(users.tokens.get('1')).toEqual(stored)
    expect([...sessions.sessions.keys()]).toEqual(['a'])
    expect(await accessToken('1')).toBe('ghu_2')
  })

  it('is refreshed once for concurrent requests (refresh tokens are single-use)', async () => {
    const { accessToken, users, identity } = world()
    await users.saveTokens('1', { ...TOKENS, accessTokenExpiresAt: after(MINUTE) })
    identity.refreshes.set('ghr_1', { ...TOKENS, accessToken: 'ghu_2', refreshToken: 'ghr_2' })
    let open = () => {}
    identity.refreshGate = new Promise<void>((resolve) => {
      open = resolve
    })

    const first = accessToken('1')
    const second = accessToken('1')
    open()
    expect(await Promise.all([first, second])).toEqual(['ghu_2', 'ghu_2'])
    expect(identity.calls.refresh).toBe(1)
  })
})

describe('session purge', () => {
  it('deletes the sessions expired at the current time and counts them', async () => {
    const { auth, sessions, advance } = world()
    await sessions.create({
      idHash: 'old',
      userId: '1',
      expiresAt: after(DAY),
      lastSeenAt: NOW,
      createdAt: NOW,
    })
    await sessions.create({
      idHash: 'live',
      userId: '1',
      expiresAt: after(5 * DAY),
      lastSeenAt: NOW,
      createdAt: NOW,
    })
    expect(await auth.purgeExpiredSessions()).toBe(0)
    advance(2 * DAY)
    expect(await auth.purgeExpiredSessions()).toBe(1)
    expect(await sessions.find('old')).toBeNull()
    expect(await sessions.find('live')).not.toBeNull()
  })
})
