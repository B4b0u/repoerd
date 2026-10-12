import { apiPaths } from '@repoerd/contracts'
import { describe, expect, it } from 'vitest'
import {
  GitHubRateLimitedError,
  GitHubUnavailableError,
} from '../../src/application/ports/github-errors.js'
import { FAKE_APP } from '../fakes/fake-github.js'
import { buildRealModeApp, cookiesFrom, jsonRequest } from './build-app.js'

async function unlocked() {
  const world = buildRealModeApp({ ready: false })
  await world.setup.issueCode()
  const response = await world.app.request(
    apiPaths.setupUnlock,
    jsonRequest('POST', { code: 'ABCD-EFGH-JKMN' }),
  )
  const grant = cookiesFrom(response).repoerd_setup ?? ''
  return { ...world, unlockResponse: response, grantCookie: `repoerd_setup=${grant}` }
}

describe('setup routes', () => {
  it('report the setup state of a fresh instance', async () => {
    const { app } = buildRealModeApp({ ready: false })
    expect(await (await app.request(apiPaths.setupStatus)).json()).toEqual({
      mode: 'real',
      state: 'needs-app',
      unlocked: false,
      publicUrl: null,
      app: null,
    })
  })

  it('unlock with the one-time code and hand out the grant cookie', async () => {
    const { app, unlockResponse, grantCookie, setup } = await unlocked()
    expect(unlockResponse.status).toBe(204)
    expect(grantCookie).toBe('repoerd_setup=token-1')
    expect(unlockResponse.headers.getSetCookie()[0]).toContain('HttpOnly')
    expect(
      await (await app.request(apiPaths.setupStatus, { headers: { cookie: grantCookie } })).json(),
    ).toMatchObject({ unlocked: true })

    await setup.issueCode()
    const wrong = await app.request(apiPaths.setupUnlock, jsonRequest('POST', { code: 'WRONG' }))
    expect(wrong.status).toBe(400)
    expect(await wrong.json()).toMatchObject({ error: { code: 'invalid_setup_code' } })
  })

  it('use __Host- cookies for the setup grant and the manifest state over HTTPS', async () => {
    const world = buildRealModeApp({ ready: false })
    await world.setup.issueCode()
    const origin = 'https://erd.example.com'
    const unlock = await world.app.request(
      `${origin}${apiPaths.setupUnlock}`,
      jsonRequest('POST', { code: 'ABCD-EFGH-JKMN' }),
    )
    expect(cookiesFrom(unlock)).toEqual({ '__Host-repoerd_setup': 'token-1' })
    const grant = '__Host-repoerd_setup=token-1'

    const started = await world.app.request(
      `${origin}${apiPaths.setupManifest}`,
      jsonRequest('POST', { publicUrl: origin }, grant),
    )
    expect(started.status).toBe(200)
    expect(cookiesFrom(started)).toEqual({ '__Host-repoerd_manifest': 'token-2' })

    const done = await world.app.request(
      `${origin}/setup/github/callback?code=manifest-code&state=token-2`,
      { headers: { cookie: `${grant}; __Host-repoerd_manifest=token-2` } },
    )
    expect(done.headers.get('location')).toBe('/setup')
    expect(cookiesFrom(done)).toMatchObject({ '__Host-repoerd_manifest': '' })
  })

  it('start the manifest flow and save the App on the GitHub callback, checking the state', async () => {
    const { app, grantCookie, config } = await unlocked()
    const started = await app.request(
      apiPaths.setupManifest,
      jsonRequest('POST', { publicUrl: 'https://erd.example.com' }, grantCookie),
    )
    expect(started.status).toBe(200)
    const body = (await started.json()) as { postUrl: string; manifest: { url: string } }
    expect(body.postUrl).toBe('https://github.com/settings/apps/new?state=token-2')
    expect(body.manifest.url).toBe('https://erd.example.com')
    const stateCookie = `repoerd_manifest=${cookiesFrom(started).repoerd_manifest}`
    expect(stateCookie).toBe('repoerd_manifest=token-2')

    const both = `${grantCookie}; ${stateCookie}`
    const callback = (query: string, cookie: string) =>
      app.request(`/setup/github/callback?${query}`, { headers: { cookie } })

    const tampered = await callback('code=manifest-code&state=other', both)
    expect(tampered.headers.get('location')).toBe('/setup?error=state')
    const withoutGrant = await callback('code=manifest-code&state=token-2', stateCookie)
    expect(withoutGrant.headers.get('location')).toBe('/setup?error=invalid-grant')
    expect(config.config.app).toBeNull()

    const done = await callback('code=manifest-code&state=token-2', both)
    expect(done.status).toBe(302)
    expect(done.headers.get('location')).toBe('/setup')
    expect(cookiesFrom(done)).toMatchObject({ repoerd_manifest: '' })
    expect(config.config.app).toEqual(FAKE_APP)
  })

  it('send GitHub failures during the manifest callback back to the setup page', async () => {
    const { app, grantCookie, registrar, logged, warned } = await unlocked()
    const failures = [
      new Error('connect ECONNREFUSED'),
      new GitHubRateLimitedError(null),
      new GitHubUnavailableError('GitHub POST /app-manifests/{code}/conversions failed: 502'),
    ]
    for (const failure of failures) {
      registrar.convertManifest = async () => {
        throw failure
      }
      const started = await app.request(
        apiPaths.setupManifest,
        jsonRequest('POST', { publicUrl: 'https://erd.example.com' }, grantCookie),
      )
      const state = cookiesFrom(started).repoerd_manifest
      const callback = await app.request(`/setup/github/callback?code=secret-code&state=${state}`, {
        headers: { cookie: `${grantCookie}; repoerd_manifest=${state}` },
      })
      expect(callback.status).toBe(302)
      expect(callback.headers.get('location')).toBe('/setup?error=github')
    }
    expect(logged).toHaveLength(1)
    // Routine GitHub trouble: warnings without stack.
    expect(warned).toHaveLength(2)
    expect(JSON.stringify([logged, warned])).not.toContain('secret-code')
  })

  it('answer 502 when GitHub is unavailable while checking an existing App', async () => {
    const { app, grantCookie, registrar } = await unlocked()
    registrar.verify = async () => {
      throw new GitHubUnavailableError('GitHub GET /app failed: 503')
    }
    const response = await app.request(
      apiPaths.setupExistingApp,
      jsonRequest(
        'POST',
        {
          publicUrl: 'https://erd.example.com',
          appId: 42,
          clientId: 'Iv1.client',
          clientSecret: 's',
          privateKey: 'k',
        },
        grantCookie,
      ),
    )
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: { code: 'github_error' } })
  })

  it('save an existing App once GitHub confirmed it', async () => {
    const { app, grantCookie, config } = await unlocked()
    const input = {
      publicUrl: 'https://erd.example.com',
      appId: 42,
      clientId: 'Iv1.client',
      clientSecret: 's',
      privateKey: 'k',
    }

    const rejected = await app.request(
      apiPaths.setupExistingApp,
      jsonRequest('POST', { ...input, clientId: 'Iv1.other' }, grantCookie),
    )
    expect(rejected.status).toBe(400)
    expect(await rejected.json()).toMatchObject({
      error: { code: 'github_error', details: { reason: 'app-credentials-rejected' } },
    })

    expect(
      (await app.request(apiPaths.setupExistingApp, jsonRequest('POST', input, grantCookie)))
        .status,
    ).toBe(204)
    expect(config.config.app).toMatchObject({ appId: 42, clientSecret: 's' })
    expect(
      (
        await app.request(
          apiPaths.setupExistingApp,
          jsonRequest('POST', { appId: 'x' }, grantCookie),
        )
      ).status,
    ).toBe(400)
  })

  it('refuse changes without the grant, and every change once configured', async () => {
    const { app } = await unlocked()
    const anonymous = await app.request(
      apiPaths.setupManifest,
      jsonRequest('POST', { publicUrl: 'https://erd.example.com' }),
    )
    expect(anonymous.status).toBe(403)

    const ready = buildRealModeApp()
    const late = await ready.app.request(
      apiPaths.setupUnlock,
      jsonRequest('POST', { code: 'ABCD-EFGH-JKMN' }),
    )
    expect(late.status).toBe(409)
    expect(await late.json()).toMatchObject({
      error: { code: 'conflict', details: { reason: 'already-configured' } },
    })
  })

  it('answer 429 past 30 wrong codes a minute, and still accept the right one', async () => {
    const { app, setup } = buildRealModeApp({ ready: false })
    await setup.issueCode()
    const unlock = (code: string) =>
      app.request(apiPaths.setupUnlock, jsonRequest('POST', { code }))
    for (let attempt = 1; attempt <= 30; attempt++) {
      expect((await unlock('WRONG-CODE-0000')).status).toBe(400)
    }
    const limited = await unlock('WRONG-CODE-0000')
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('2')
    expect(await limited.json()).toEqual({
      error: {
        code: 'rate_limited',
        message: 'Too many wrong setup codes. Try again in a moment.',
      },
    })
    expect((await unlock('ABCD-EFGH-JKMN')).status).toBe(204)
  })

  it('asks for the setup code before anything else', async () => {
    const { app } = buildRealModeApp({ ready: false })
    const response = await app.request(
      apiPaths.setupManifest,
      jsonRequest('POST', { publicUrl: 'https://erd.example.com' }),
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { code: 'forbidden', details: { reason: 'setup-code-required' } },
    })
  })
})
