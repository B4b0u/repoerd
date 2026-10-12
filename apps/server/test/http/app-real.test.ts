import { apiPaths, MUTATION_HEADER, type SchemaResponse } from '@repoerd/contracts'
import { describe, expect, it } from 'vitest'
import {
  GitHubRateLimitedError,
  GitHubUnavailableError,
} from '../../src/application/ports/github-errors.js'
import { accessible } from '../fakes/in-memory-repo-directory.js'
import { buildRealModeApp, cookiesFrom, DAY, jsonRequest } from './build-app.js'

const repo = { owner: 'acme', name: 'shop' }

describe('HTTP API (real mode)', () => {
  it('asks for setup while the instance is not configured', async () => {
    const { app } = buildRealModeApp({ ready: false })
    const response = await app.request('/api/repos')
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'setup_required' } })
    expect((await app.request('/healthz')).status).toBe(200)
  })

  it('requires a session cookie, and clears unknown ones', async () => {
    const { app } = buildRealModeApp()
    const anonymous = await app.request('/api/repos')
    expect(anonymous.status).toBe(401)
    expect(await anonymous.json()).toMatchObject({ error: { code: 'unauthenticated' } })

    const forged = await app.request('/api/me', { headers: { cookie: 'repoerd_session=forged' } })
    expect(forged.status).toBe(401)
    expect(cookiesFrom(forged)).toEqual({ repoerd_session: '' })
  })

  it('serves the signed-in user and their repositories', async () => {
    const { app, signIn } = buildRealModeApp()
    const cookie = await signIn()
    expect(await (await app.request('/api/me', { headers: { cookie } })).json()).toEqual({
      user: { id: '1', login: 'alice', avatarUrl: null, isAdmin: false },
      mode: 'real',
    })
    expect(await (await app.request('/api/repos', { headers: { cookie } })).json()).toEqual({
      repos: [{ owner: 'acme', name: 'shop', defaultBranch: 'main', private: false }],
    })
  })

  it('renews the session cookie once a day, __Host- and Secure except on plain-HTTP localhost', async () => {
    const { app, signIn, advance } = buildRealModeApp()
    const cookie = await signIn()
    const hostCookie = `__Host-${cookie}`
    expect(cookiesFrom(await app.request('/api/me', { headers: { cookie } }))).toEqual({})

    advance(25 * 3600_000)
    const renewed = await app.request('https://erd.example.com/api/me', {
      headers: { cookie: hostCookie },
    })
    expect(cookiesFrom(renewed)).toEqual({ '__Host-repoerd_session': 'session-1' })
    const line = renewed.headers.getSetCookie()[0] ?? ''
    expect(line).toContain('HttpOnly')
    expect(line).toContain('SameSite=Lax')
    expect(line).toContain('Secure')
    expect(line).toContain('Path=/')
    expect(line).not.toContain('Domain')
    expect(line).toContain(
      `Expires=${new Date(Date.parse('2026-10-11T13:00:00Z') + 30 * DAY).toUTCString()}`,
    )

    const local = await app.request('/api/me', { headers: { cookie: 'repoerd_session=forged' } })
    expect(local.headers.getSetCookie()[0]).not.toContain('Secure')

    advance(25 * 3600_000)
    const localRenewal = await app.request('/api/me', { headers: { cookie } })
    expect(cookiesFrom(localRenewal)).toEqual({ repoerd_session: 'session-1' })
    expect(localRenewal.headers.getSetCookie()[0]).not.toContain('Secure')

    advance(25 * 3600_000)
    const behindProxy = await app.request('/api/me', {
      headers: { cookie: hostCookie, 'x-forwarded-proto': 'https' },
    })
    expect(cookiesFrom(behindProxy)).toEqual({ '__Host-repoerd_session': 'session-1' })
    expect(behindProxy.headers.getSetCookie()[0]).toContain('Secure')
  })

  it('ignores an unprefixed session cookie over HTTPS, as a sibling site could plant it', async () => {
    const { app, signIn } = buildRealModeApp()
    const cookie = await signIn()
    const response = await app.request('https://erd.example.com/api/me', { headers: { cookie } })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: { code: 'unauthenticated' } })
  })

  it('forbids caching API answers, errors included', async () => {
    const { app, signIn } = buildRealModeApp({
      getBranchSchema: async () => {
        throw new Error('boom')
      },
    })
    const cookie = await signIn()
    for (const path of ['/api/me', apiPaths.schema(repo), '/api/nothing-here', '/api/repos']) {
      const response = await app.request(path, { headers: { cookie } })
      expect([path, response.headers.get('cache-control')]).toEqual([path, 'no-store'])
    }
    expect((await app.request('/api/me')).headers.get('cache-control')).toBe('no-store')
    expect((await app.request('/healthz')).headers.get('cache-control')).toBeNull()

    const noHeader = await app.request(apiPaths.logout, { method: 'POST', headers: { cookie } })
    expect([noHeader.status, noHeader.headers.get('cache-control')]).toEqual([403, 'no-store'])
    const tooBig = await app.request(apiPaths.logout, {
      method: 'POST',
      headers: { cookie, [MUTATION_HEADER]: '1' },
      body: 'x'.repeat(4 * 1024 * 1024 + 1),
    })
    expect([tooBig.status, tooBig.headers.get('cache-control')]).toEqual([413, 'no-store'])
  })

  it('links the schema to its commit on GitHub', async () => {
    const { app, signIn } = buildRealModeApp()
    const cookie = await signIn()
    const body = (await (
      await app.request(apiPaths.schema(repo), { headers: { cookie } })
    ).json()) as SchemaResponse
    expect(body.commitUrl).toBe(`https://github.com/acme/shop/commit/${body.commitSha}`)
  })

  it('hides invisible repositories behind the same 404 on every route', async () => {
    const { app, signIn, directory } = buildRealModeApp()
    const cookie = await signIn()
    const secret = { owner: 'acme', name: 'secret' }
    const notFound = await (
      await app.request('/api/repos/acme/nope/schema', { headers: { cookie } })
    ).json()
    for (const path of [
      apiPaths.schema(secret),
      apiPaths.branches(secret),
      apiPaths.layout(secret, 's', 'ALL_FIELDS'),
    ]) {
      const response = await app.request(path, { headers: { cookie } })
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual(notFound)
    }
    for (const method of ['PATCH', 'PUT'] as const) {
      const write = await app.request(
        apiPaths.layout(secret, 's', 'ALL_FIELDS'),
        jsonRequest(method, { positions: [] }, cookie),
      )
      expect(write.status).toBe(404)
      expect(await write.json()).toEqual(notFound)
    }

    // Visible to the user but gone from GitHub: the same 404 again.
    const ghost = { owner: 'acme', name: 'ghost' }
    directory.snapshot = {
      accounts: ['acme'],
      repos: [accessible('acme', 'shop', true), accessible('acme', 'ghost')],
    }
    for (const path of [apiPaths.schema(ghost), apiPaths.branches(ghost)]) {
      const response = await app.request(path, { headers: { cookie } })
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual(notFound)
    }
  })

  it('sends the user back to GitHub when their authorisation is gone', async () => {
    const { app, signIn, directory } = buildRealModeApp()
    const cookie = await signIn()
    directory.snapshot = null
    for (const path of ['/api/repos', apiPaths.schema(repo)]) {
      const response = await app.request(path, { headers: { cookie } })
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ error: { code: 'reauth_required' } })
    }
  })

  it('refuses users outside the allowed organisations', async () => {
    const { app, signIn, directory, config } = buildRealModeApp()
    const cookie = await signIn()
    config.config = { ...config.config, allowedOrgs: ['acme'] }
    directory.snapshot = { accounts: ['someone-else'], repos: [] }
    const response = await app.request('/api/repos', { headers: { cookie } })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'org_not_allowed' } })
  })

  it('turns GitHub rate limits into a readable 503 with Retry-After', async () => {
    const { app, signIn, logged, warned } = buildRealModeApp({
      getBranchSchema: async () => {
        throw new GitHubRateLimitedError(42)
      },
    })
    const cookie = await signIn()
    const response = await app.request(apiPaths.schema(repo), { headers: { cookie } })
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('42')
    expect(await response.json()).toEqual({
      error: {
        code: 'github_rate_limited',
        message: 'GitHub rate limit reached. Try again in a few minutes.',
      },
    })
    expect(logged).toHaveLength(0)
    expect(warned).toEqual([{ retryAfterSeconds: 42, message: 'GitHub rate limit reached' }])
  })

  it('turns an unavailable GitHub into a 502 logged as a warning, without stack', async () => {
    const { app, signIn, logged, warned } = buildRealModeApp({
      getBranchSchema: async () => {
        throw new GitHubUnavailableError('GitHub GET /repos/acme/shop failed: 503')
      },
    })
    const cookie = await signIn()
    const response = await app.request(apiPaths.schema(repo), { headers: { cookie } })
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: { code: 'github_error', message: 'GitHub is not responding. Try again.' },
    })
    expect(logged).toHaveLength(0)
    expect(warned).toEqual([
      {
        reason: 'GitHub GET /repos/acme/shop failed: 503',
        message: 'GitHub is not responding',
      },
    ])
  })

  it('signs out over HTTPS: clears the __Host- session cookie', async () => {
    const { app, signIn } = buildRealModeApp()
    const cookie = `__Host-${await signIn()}`
    const response = await app.request(`https://erd.example.com${apiPaths.logout}`, {
      method: 'POST',
      headers: { cookie, [MUTATION_HEADER]: '1' },
    })
    expect(response.status).toBe(204)
    expect(cookiesFrom(response)).toEqual({ '__Host-repoerd_session': '' })
    const line = response.headers.getSetCookie()[0] ?? ''
    expect(line).toContain('Max-Age=0')
    expect(line).toContain('Secure')
  })

  it('signs out: deletes the session and clears the cookie', async () => {
    const { app, signIn, sessions } = buildRealModeApp()
    const cookie = await signIn()
    const response = await app.request(apiPaths.logout, {
      method: 'POST',
      headers: { cookie, [MUTATION_HEADER]: '1' },
    })
    expect(response.status).toBe(204)
    expect(cookiesFrom(response)).toEqual({ repoerd_session: '' })
    expect(sessions.sessions.size).toBe(0)
    expect((await app.request('/api/me', { headers: { cookie } })).status).toBe(401)
  })
})
