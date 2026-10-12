import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import {
  GitHubRateLimitedError,
  GitHubUnavailableError,
} from '../../src/application/ports/github-errors.js'
import { GitHubApi } from '../../src/infrastructure/github/github-api.js'
import { GitHubAppRegistrar } from '../../src/infrastructure/github/github-app-registrar.js'
import { GitHubIdentityClient } from '../../src/infrastructure/github/github-identity-client.js'
import { githubServer, TEST_APP } from '../fakes/github-app.js'

const server = githubServer()
const api = new GitHubApi()
const NOW = new Date('2026-10-10T12:00:00Z')
const identity = new GitHubIdentityClient(api, () => NOW)
const oauthApp = { clientId: 'Iv1.client', clientSecret: 'secret' }
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000)

function tokenEndpoint(response: object, seen: { body?: unknown; accept?: string | null } = {}) {
  return http.post('https://github.com/login/oauth/access_token', async ({ request }) => {
    seen.body = await request.json()
    seen.accept = request.headers.get('accept')
    return HttpResponse.json(response)
  })
}

describe('GitHubIdentityClient', () => {
  it('sends the OAuth pages and the token request to the configured web origin', async () => {
    const urls: string[] = []
    const fetchStub = (async (url: string) => {
      urls.push(url)
      return Response.json({ access_token: 'ghu_local' })
    }) as unknown as typeof fetch
    const origin = 'http://127.0.0.1:3402'
    const local = new GitHubIdentityClient(
      new GitHubApi(fetchStub, undefined, { api: origin, web: origin }),
      () => NOW,
    )
    const redirectUri = 'http://localhost:3401/auth/callback'
    expect(local.authorizeUrl({ clientId: 'Iv1.client', redirectUri, state: 's' })).toMatch(
      /^http:\/\/127\.0\.0\.1:3402\/login\/oauth\/authorize\?/,
    )
    expect(await local.exchangeCode(oauthApp, { code: 'c', redirectUri })).toMatchObject({
      accessToken: 'ghu_local',
    })
    expect(urls).toEqual(['http://127.0.0.1:3402/login/oauth/access_token'])
  })

  it('builds the authorize URL', () => {
    expect(
      identity.authorizeUrl({
        clientId: 'Iv1.client',
        redirectUri: 'https://erd.example.com/auth/callback',
        state: 's1',
      }),
    ).toBe(
      'https://github.com/login/oauth/authorize?client_id=Iv1.client&redirect_uri=https%3A%2F%2Ferd.example.com%2Fauth%2Fcallback&state=s1',
    )
  })

  it('exchanges a code for expiring tokens', async () => {
    const seen: { body?: unknown; accept?: string | null } = {}
    server.use(
      tokenEndpoint(
        {
          access_token: 'ghu_a',
          expires_in: 28800,
          refresh_token: 'ghr_b',
          refresh_token_expires_in: 15897600,
          token_type: 'bearer',
          scope: '',
        },
        seen,
      ),
    )
    expect(
      await identity.exchangeCode(oauthApp, {
        code: 'c1',
        redirectUri: 'https://erd.example.com/auth/callback',
      }),
    ).toEqual({
      accessToken: 'ghu_a',
      accessTokenExpiresAt: later(28800),
      refreshToken: 'ghr_b',
      refreshTokenExpiresAt: later(15897600),
    })
    expect(seen.body).toEqual({
      client_id: 'Iv1.client',
      client_secret: 'secret',
      code: 'c1',
      redirect_uri: 'https://erd.example.com/auth/callback',
    })
    expect(seen.accept).toBe('application/json')
  })

  it('accepts non-expiring tokens and turns OAuth errors into null', async () => {
    server.use(tokenEndpoint({ access_token: 'ghu_c', token_type: 'bearer', scope: '' }))
    expect(await identity.exchangeCode(oauthApp, { code: 'c2', redirectUri: 'x' })).toEqual({
      accessToken: 'ghu_c',
      accessTokenExpiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
    })
    server.use(
      tokenEndpoint({
        error: 'bad_verification_code',
        error_description: 'The code is incorrect or expired.',
      }),
    )
    expect(await identity.exchangeCode(oauthApp, { code: 'old', redirectUri: 'x' })).toBeNull()
  })

  it('refreshes tokens, or returns null when GitHub refuses the refresh token', async () => {
    const seen: { body?: unknown } = {}
    server.use(
      tokenEndpoint(
        {
          access_token: 'ghu_new',
          expires_in: 28800,
          refresh_token: 'ghr_new',
          refresh_token_expires_in: 100,
        },
        seen,
      ),
    )
    expect(await identity.refresh(oauthApp, 'ghr_old')).toMatchObject({
      accessToken: 'ghu_new',
      refreshToken: 'ghr_new',
    })
    expect(seen.body).toEqual({
      client_id: 'Iv1.client',
      client_secret: 'secret',
      grant_type: 'refresh_token',
      refresh_token: 'ghr_old',
    })

    server.use(tokenEndpoint({ error: 'bad_refresh_token' }))
    expect(await identity.refresh(oauthApp, 'ghr_used')).toBeNull()
  })

  it('throws on token endpoint failures instead of returning null', async () => {
    server.use(
      http.post(
        'https://github.com/login/oauth/access_token',
        () => new HttpResponse(null, { status: 502 }),
      ),
    )
    await expect(identity.exchangeCode(oauthApp, { code: 'c', redirectUri: 'x' })).rejects.toThrow(
      GitHubUnavailableError,
    )
    await expect(identity.refresh(oauthApp, 'r')).rejects.toThrow(GitHubUnavailableError)
  })

  it('leaves refreshTokenExpiresAt null when GitHub sends no refresh token expiry', async () => {
    server.use(tokenEndpoint({ access_token: 'a', expires_in: 10, refresh_token: 'r' }))
    expect(await identity.refresh(oauthApp, 'old')).toMatchObject({
      refreshToken: 'r',
      refreshTokenExpiresAt: null,
    })
  })

  it('reads the profile and the accounts of the installations the user can access', async () => {
    server.use(
      http.get('https://api.github.com/user', () =>
        HttpResponse.json({ id: 123, login: 'alice', avatar_url: 'https://avatars.example/123' }),
      ),
      http.get('https://api.github.com/user/installations', () =>
        HttpResponse.json({
          total_count: 3,
          installations: [
            { id: 1, account: { login: 'acme' } },
            { id: 2, account: { login: 'alice' } },
            { id: 3, account: { login: 'acme' } },
          ],
        }),
      ),
    )
    expect(await identity.getProfile('ghu_a')).toEqual({
      id: '123',
      login: 'alice',
      avatarUrl: 'https://avatars.example/123',
    })
    expect(await identity.listInstallationAccounts('ghu_a')).toEqual(['acme', 'alice'])
  })
})

describe('GitHubAppRegistrar', () => {
  const registrar = new GitHubAppRegistrar(api, () => NOW)
  const appJson = {
    id: 42,
    slug: 'repoerd-test',
    name: 'RepoERD test',
    html_url: 'https://github.com/apps/repoerd-test',
    owner: { login: 'acme', type: 'User' },
    client_id: 'Iv1.client',
  }

  const verifyInput = {
    appId: 42,
    clientId: 'Iv1.client',
    clientSecret: 'secret',
    privateKey: TEST_APP.privateKey,
  }

  it('converts a manifest code into App credentials, or null when GitHub refuses it', async () => {
    server.use(
      http.post('https://api.github.com/app-manifests/:code/conversions', ({ params }) =>
        params.code === 'good'
          ? HttpResponse.json({
              ...appJson,
              client_secret: 'secret',
              pem: TEST_APP.privateKey,
              webhook_secret: null,
            })
          : new HttpResponse(null, { status: 404 }),
      ),
    )
    expect(await registrar.convertManifest('good')).toEqual({ ...TEST_APP, clientSecret: 'secret' })
    expect(await registrar.convertManifest('expired')).toBeNull()
  })

  it('records an App owned by an organisation', async () => {
    server.use(
      http.get('https://api.github.com/app', () =>
        HttpResponse.json({ ...appJson, owner: { login: 'acme', type: 'Organization' } }),
      ),
    )
    const verified = await registrar.verify(verifyInput)
    expect(verified?.ownerType).toBe('Organization')
  })

  it('records an App without owner, or without owner type, as owned by a user', async () => {
    for (const owner of [null, { login: 'acme' }]) {
      server.use(
        http.get('https://api.github.com/app', () => HttpResponse.json({ ...appJson, owner })),
      )
      const verified = await registrar.verify(verifyInput)
      expect(verified?.ownerType).toBe('User')
    }
  })

  it('throws on GitHub failures and propagates rate limits', async () => {
    for (const status of [500, 502]) {
      server.use(
        http.post(
          'https://api.github.com/app-manifests/:code/conversions',
          () => new HttpResponse(null, { status }),
        ),
        http.get('https://api.github.com/app', () => new HttpResponse(null, { status })),
      )
      await expect(registrar.convertManifest('c')).rejects.toBeInstanceOf(GitHubUnavailableError)
      await expect(registrar.verify(verifyInput)).rejects.toBeInstanceOf(GitHubUnavailableError)
    }
    // The manifest code is a secret: the error (logged as a warning) never shows it.
    await expect(registrar.convertManifest('secret-code')).rejects.toThrow(
      new GitHubUnavailableError('GitHub POST /app-manifests/{code}/conversions failed: 502'),
    )
    server.use(
      http.post(
        'https://api.github.com/app-manifests/:code/conversions',
        () => new HttpResponse(null, { status: 429 }),
      ),
      http.get('https://api.github.com/app', () => new HttpResponse(null, { status: 429 })),
    )
    await expect(registrar.convertManifest('c')).rejects.toBeInstanceOf(GitHubRateLimitedError)
    await expect(registrar.verify(verifyInput)).rejects.toBeInstanceOf(GitHubRateLimitedError)
  })

  it('rejects credentials whose app id does not match', async () => {
    server.use(http.get('https://api.github.com/app', () => HttpResponse.json(appJson)))
    expect(await registrar.verify({ ...verifyInput, appId: 43 })).toBeNull()
  })

  it('verifies existing credentials with GET /app', async () => {
    let authorization: string | null = null
    server.use(
      http.get('https://api.github.com/app', ({ request }) => {
        authorization = request.headers.get('authorization')
        return HttpResponse.json(appJson)
      }),
    )
    const input = {
      appId: 42,
      clientId: 'Iv1.client',
      clientSecret: 'secret',
      privateKey: TEST_APP.privateKey,
    }
    expect(await registrar.verify(input)).toEqual({ ...TEST_APP, clientSecret: 'secret' })
    expect(authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/)
    expect(await registrar.verify({ ...input, clientId: 'Iv1.other' })).toBeNull()
    expect(await registrar.verify({ ...input, privateKey: 'not a key' })).toBeNull()

    server.use(
      http.get('https://api.github.com/app', () => new HttpResponse(null, { status: 401 })),
    )
    expect(await registrar.verify(input)).toBeNull()
  })
})
