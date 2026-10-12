import { apiPaths } from '@repoerd/contracts'
import { describe, expect, it } from 'vitest'
import { GitHubRateLimitedError } from '../../src/application/ports/github-errors.js'
import type { OAuthTokens } from '../../src/application/ports/github-identity.js'
import { FAKE_APP } from '../fakes/fake-github.js'
import { buildRealModeApp, cookiesFrom, DAY, NOW } from './build-app.js'

const TOKENS: OAuthTokens = {
  accessToken: 'ghu_1',
  accessTokenExpiresAt: new Date(NOW.getTime() + 8 * 3600_000),
  refreshToken: 'ghr_1',
  refreshTokenExpiresAt: new Date(NOW.getTime() + 180 * DAY),
}

async function startSignIn(world: ReturnType<typeof buildRealModeApp>, next: string) {
  const response = await world.app.request(apiPaths.signIn(next))
  return { response, cookie: `repoerd_oauth=${cookiesFrom(response).repoerd_oauth}` }
}

describe('sign-in routes', () => {
  it('redirect to GitHub with a state cookie, then sign in on the callback', async () => {
    const world = buildRealModeApp()
    world.identity.codes.set('code-1', TOKENS)
    const { response, cookie } = await startSignIn(world, '/acme/shop?branch=feature%2Fx')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('https://github.test/authorize?')
    expect(response.headers.get('location')).toContain('state=token-1')
    expect(cookie.startsWith('repoerd_oauth=token-1.')).toBe(true)

    const callback = await world.app.request('/auth/callback?code=code-1&state=token-1', {
      headers: { cookie },
    })
    expect(callback.headers.get('location')).toBe('/acme/shop?branch=feature%2Fx')
    const cookies = cookiesFrom(callback)
    expect(cookies).toMatchObject({ repoerd_session: 'token-2', repoerd_oauth: '' })

    const me = await world.app.request('/api/me', {
      headers: { cookie: 'repoerd_session=token-2' },
    })
    expect(await me.json()).toMatchObject({ user: { login: 'alice' } })
  })

  it('use __Host- cookies over HTTPS', async () => {
    const world = buildRealModeApp()
    world.identity.codes.set('code-1', TOKENS)
    const login = await world.app.request(`https://erd.example.com${apiPaths.signIn('/')}`)
    const state = cookiesFrom(login)['__Host-repoerd_oauth'] ?? ''
    expect(state.startsWith('token-1.')).toBe(true)

    const callback = await world.app.request(
      'https://erd.example.com/auth/callback?code=code-1&state=token-1',
      { headers: { cookie: `__Host-repoerd_oauth=${state}` } },
    )
    expect(cookiesFrom(callback)).toMatchObject({
      '__Host-repoerd_session': 'token-2',
      '__Host-repoerd_oauth': '',
    })
  })

  it('never redirect off-site', async () => {
    const world = buildRealModeApp()
    world.identity.codes.set('code-1', TOKENS)
    for (const next of ['//evil.example', 'https://evil.example', '/\\evil.example']) {
      const { cookie } = await startSignIn(world, next)
      const state = cookie.slice('repoerd_oauth='.length).split('.')[0]
      world.identity.codes.set(`code-${state}`, TOKENS)
      const callback = await world.app.request(`/auth/callback?code=code-${state}&state=${state}`, {
        headers: { cookie },
      })
      expect(callback.headers.get('location')).toBe('/')
    }
  })

  it('refuse a missing or mismatched state without calling GitHub', async () => {
    const world = buildRealModeApp()
    const { cookie } = await startSignIn(world, '/')
    const noCookie = await world.app.request('/auth/callback?code=code-1&state=token-1')
    expect(noCookie.headers.get('location')).toBe('/signin?error=state')
    const mismatch = await world.app.request('/auth/callback?code=code-1&state=other', {
      headers: { cookie },
    })
    expect(mismatch.headers.get('location')).toBe('/signin?error=state')
    expect(world.identity.calls.exchange).toBe(0)
    expect(world.sessions.sessions.size).toBe(0)
  })

  it('report refused codes and cancelled sign-ins', async () => {
    const world = buildRealModeApp()
    const { cookie } = await startSignIn(world, '/')
    const refused = await world.app.request('/auth/callback?code=unknown&state=token-1', {
      headers: { cookie },
    })
    expect(refused.headers.get('location')).toBe('/signin?error=invalid-code')
    const denied = await world.app.request('/auth/callback?error=access_denied&state=token-1', {
      headers: { cookie },
    })
    expect(denied.headers.get('location')).toBe('/signin?error=denied')
  })

  it('send GitHub failures back to the sign-in page, logging only unexpected ones', async () => {
    const world = buildRealModeApp()
    const failures = [new Error('connect ECONNREFUSED'), new GitHubRateLimitedError(60)]
    for (const failure of failures) {
      world.identity.exchangeCode = async () => {
        throw failure
      }
      const { cookie } = await startSignIn(world, '/')
      const state = cookie.slice('repoerd_oauth='.length).split('.')[0]
      const callback = await world.app.request(`/auth/callback?code=secret-code&state=${state}`, {
        headers: { cookie },
      })
      expect(callback.status).toBe(302)
      expect(callback.headers.get('location')).toBe('/signin?error=github')
    }
    expect(world.logged).toHaveLength(1)
    expect(JSON.stringify(world.logged)).not.toContain('secret-code')
  })

  it('make the browser that ran the setup the first administrator', async () => {
    const world = buildRealModeApp({ ready: false })
    world.config.config = {
      ...world.config.config,
      publicUrl: 'https://erd.example.com',
      app: FAKE_APP,
      setupGrant: { hash: 'hash(grant-1)', expiresAt: new Date(NOW.getTime() + 3600_000) },
    }
    world.identity.codes.set('code-1', TOKENS)
    const { cookie } = await startSignIn(world, '/setup')
    const callback = await world.app.request('/auth/callback?code=code-1&state=token-1', {
      headers: { cookie: `${cookie}; repoerd_setup=grant-1` },
    })
    expect(callback.headers.get('location')).toBe('/setup')
    expect(cookiesFrom(callback)).toMatchObject({ repoerd_setup: '' })
    expect(world.users.users.get('1')?.isAdmin).toBe(true)
    expect(await (await world.app.request(apiPaths.setupStatus)).json()).toMatchObject({
      state: 'ready',
    })
  })

  it('send sign-ins to /setup while no App is configured', async () => {
    const world = buildRealModeApp({ ready: false })
    expect((await world.app.request(apiPaths.signIn('/'))).headers.get('location')).toBe('/setup')
  })
})
