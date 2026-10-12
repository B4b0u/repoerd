import { APP_REPLACED_PATH, apiPaths } from '@repoerd/contracts'
import { describe, expect, it } from 'vitest'
import { GitHubUnavailableError } from '../../src/application/ports/github-errors.js'
import type { GitHubAppCredentials } from '../../src/application/ports/instance-config.js'
import { FAKE_APP } from '../fakes/fake-github.js'
import { buildFakeModeApp, buildRealModeApp, cookiesFrom, jsonRequest } from './build-app.js'

const ORIGIN = 'https://erd.example.com'
const ORG_APP: GitHubAppCredentials = {
  ...FAKE_APP,
  appId: 43,
  slug: 'repoerd-acme',
  name: 'RepoERD acme',
  htmlUrl: 'https://github.com/apps/repoerd-acme',
  ownerLogin: 'acme-org',
  ownerType: 'Organization',
  clientId: 'Iv1.other',
}
const TOKENS = {
  accessToken: 'ghu_1',
  accessTokenExpiresAt: null,
  refreshToken: null,
  refreshTokenExpiresAt: null,
}

/** An administrator signed in over HTTPS: every cookie carries the __Host- prefix. */
async function adminOverHttps() {
  const world = buildRealModeApp()
  const session = `__Host-${await world.signIn('admin', 'admin')}`
  world.registrar.convertManifest = async (code) => (code === 'manifest-code' ? ORG_APP : null)
  const callback = (query: string, cookie: string) =>
    world.app.request(`${ORIGIN}/setup/github/replace-callback?${query}`, { headers: { cookie } })
  return { ...world, session, callback }
}

describe('replacing the GitHub App over HTTP', () => {
  it('creates the new App through the manifest flow over HTTPS, then signs everybody out', async () => {
    const world = await adminOverHttps()
    const bob = `__Host-${await world.signIn('2', 'bob')}`
    await world.users.saveTokens('admin', TOKENS)
    await world.users.saveTokens('2', TOKENS)
    world.config.config = { ...world.config.config, allowedOrgs: ['acme'] }

    const started = await world.app.request(
      `${ORIGIN}${apiPaths.adminAppManifest}`,
      jsonRequest('POST', { organization: 'acme-org' }, world.session),
    )
    expect(started.status).toBe(200)
    const body = (await started.json()) as { postUrl: string; manifest: Record<string, unknown> }
    expect(body.postUrl).toBe(
      'https://github.com/organizations/acme-org/settings/apps/new?state=token-1',
    )
    expect(body.manifest).toMatchObject({
      redirect_url: `${ORIGIN}/setup/github/replace-callback`,
      public: false,
    })
    expect(cookiesFrom(started)).toEqual({ '__Host-repoerd_manifest': 'token-1' })

    const done = await world.callback(
      'code=manifest-code&state=token-1',
      `${world.session}; __Host-repoerd_manifest=token-1`,
    )
    expect(done.status).toBe(302)
    expect(done.headers.get('location')).toBe(APP_REPLACED_PATH)
    expect(cookiesFrom(done)).toMatchObject({
      '__Host-repoerd_manifest': '',
      '__Host-repoerd_session': '',
    })
    expect(world.config.config).toMatchObject({
      app: ORG_APP,
      publicUrl: ORIGIN,
      allowedOrgs: ['acme'],
    })
    expect(world.forgotten()).toBe(1)
    expect(world.users.tokens.size).toBe(0)
    expect(world.sessions.sessions.size).toBe(0)
    expect(world.users.users.get('admin')?.isAdmin).toBe(true)
    const signedOut = await world.app.request(`${ORIGIN}${apiPaths.me}`, {
      headers: { cookie: bob },
    })
    expect(signedOut.status).toBe(401)
  })

  it('never replaces the App from a callback with a wrong state, without session or rights', async () => {
    const world = await adminOverHttps()
    const bob = `__Host-${await world.signIn('2', 'bob')}`
    const state = '__Host-repoerd_manifest=token-9'
    const where = async (query: string, cookie: string) =>
      (await world.callback(query, cookie)).headers.get('location')

    expect(await where('code=manifest-code&state=other', `${world.session}; ${state}`)).toBe(
      '/admin?error=state',
    )
    expect(await where('code=manifest-code&state=token-9', world.session)).toBe(
      '/admin?error=state',
    )
    expect(await where('code=manifest-code&state=token-9', state)).toBe('/admin?error=forbidden')
    expect(await where('code=manifest-code&state=token-9', `${bob}; ${state}`)).toBe(
      '/admin?error=forbidden',
    )
    // Over HTTPS the unprefixed names are not read: a sibling site could have planted them.
    expect(
      await where(
        'code=manifest-code&state=token-9',
        'repoerd_session=session-admin; repoerd_manifest=token-9',
      ),
    ).toBe('/admin?error=state')
    // The session cookie without its prefix does not count either.
    expect(
      await where('code=manifest-code&state=token-9', `${state}; repoerd_session=session-admin`),
    ).toBe('/admin?error=forbidden')
    // An administrator whose GitHub access stopped working.
    world.directory.byUser.set('admin', null)
    expect(await where('code=manifest-code&state=token-9', `${world.session}; ${state}`)).toBe(
      '/admin?error=forbidden',
    )

    expect(world.config.config.app).toEqual(FAKE_APP)
    expect(world.sessions.sessions.size).toBe(2)
    expect(world.forgotten()).toBe(0)
  })

  it('clears the manifest state cookie whatever the outcome', async () => {
    const world = await adminOverHttps()
    const state = '__Host-repoerd_manifest=token-9'
    const forbidden = await world.callback('code=manifest-code&state=token-9', state)
    expect(forbidden.headers.get('location')).toBe('/admin?error=forbidden')
    expect(cookiesFrom(forbidden)['__Host-repoerd_manifest']).toBe('')
    const rejected = await world.callback(
      'code=expired&state=token-9',
      `${world.session}; ${state}`,
    )
    expect(rejected.headers.get('location')).toBe('/admin?error=github-rejected')
    expect(cookiesFrom(rejected)['__Host-repoerd_manifest']).toBe('')
  })

  it('refuses a callback when the instance is not configured', async () => {
    const world = await adminOverHttps()
    world.config.config = { ...world.config.config, app: null }
    const response = await world.callback(
      'code=manifest-code&state=token-9',
      `${world.session}; __Host-repoerd_manifest=token-9`,
    )
    expect(response.headers.get('location')).toBe('/admin?error=not-configured')
    expect(world.config.config.app).toBeNull()
    expect(world.sessions.sessions.size).toBe(1)
    expect(world.forgotten()).toBe(0)
  })

  it('sends GitHub refusals and failures back to /admin, keeping the App and the sessions', async () => {
    const world = await adminOverHttps()
    const cookie = `${world.session}; __Host-repoerd_manifest=token-9`
    expect(
      (await world.callback('code=expired&state=token-9', cookie)).headers.get('location'),
    ).toBe('/admin?error=github-rejected')

    world.registrar.convertManifest = async () => {
      throw new GitHubUnavailableError('GitHub POST /app-manifests/{code}/conversions failed: 502')
    }
    expect(
      (await world.callback('code=secret-code&state=token-9', cookie)).headers.get('location'),
    ).toBe('/admin?error=github')
    // Routine GitHub trouble: one warning without stack, never the code.
    expect(world.warned).toHaveLength(1)
    expect(JSON.stringify(world.warned)).not.toContain('secret-code')
    expect(world.config.config.app).toEqual(FAKE_APP)
    expect(world.sessions.sessions.size).toBe(1)
  })

  it('saves new credentials checked by GitHub, ending the administrator session too', async () => {
    const world = await adminOverHttps()
    const rotated = {
      appId: 42,
      clientId: 'Iv1.client',
      clientSecret: 'rotated',
      privateKey: 'new-pem',
    }
    const response = await world.app.request(
      `${ORIGIN}${apiPaths.adminExistingApp}`,
      jsonRequest('POST', rotated, world.session),
    )
    expect(response.status).toBe(204)
    expect(cookiesFrom(response)).toEqual({ '__Host-repoerd_session': '' })
    expect(world.config.config.app).toEqual({
      ...FAKE_APP,
      clientSecret: 'rotated',
      privateKey: 'new-pem',
    })
    expect(world.sessions.sessions.size).toBe(0)
    const again = await world.app.request(
      `${ORIGIN}${apiPaths.adminExistingApp}`,
      jsonRequest('POST', rotated, world.session),
    )
    expect(again.status).toBe(401)
  })

  it('refuses credentials GitHub does not confirm, a malformed body and an invalid organisation', async () => {
    const world = await adminOverHttps()
    const send = (path: string, body: unknown) =>
      world.app.request(`${ORIGIN}${path}`, jsonRequest('POST', body, world.session))

    const wrong = await send(apiPaths.adminExistingApp, {
      appId: 7,
      clientId: 'Iv1.client',
      clientSecret: 's',
      privateKey: 'k',
    })
    expect(wrong.status).toBe(400)
    expect(await wrong.json()).toMatchObject({
      error: { code: 'github_error', details: { reason: 'app-credentials-rejected' } },
    })
    const malformed = await send(apiPaths.adminExistingApp, { appId: 'x' })
    expect(await malformed.json()).toMatchObject({ error: { details: { reason: 'invalid-body' } } })
    const badOrg = await send(apiPaths.adminAppManifest, { organization: 'not an org' })
    expect(badOrg.status).toBe(400)
    expect(await badOrg.json()).toMatchObject({
      error: { details: { reason: 'invalid-organization', login: 'not an org' } },
    })
    expect(world.config.config.app).toEqual(FAKE_APP)
    expect(world.sessions.sessions.size).toBe(1)
  })

  it('do not exist in fake mode, which has no GitHub App', async () => {
    const { app } = buildFakeModeApp()
    expect((await app.request(apiPaths.adminAppManifest, jsonRequest('POST', {}))).status).toBe(404)
    expect((await app.request(apiPaths.adminExistingApp, jsonRequest('POST', {}))).status).toBe(404)
    expect((await app.request('/setup/github/replace-callback?code=c&state=s')).status).toBe(404)
  })
})
