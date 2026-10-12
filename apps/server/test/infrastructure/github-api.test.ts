import { createPublicKey, createVerify } from 'node:crypto'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  GitHubRateLimitedError,
  GitHubUnavailableError,
} from '../../src/application/ports/github-errors.js'
import { createAppJwt } from '../../src/infrastructure/github/app-jwt.js'
import { GitHubApi, GitHubHttpError } from '../../src/infrastructure/github/github-api.js'
import { InstallationTokens } from '../../src/infrastructure/github/installation-tokens.js'
import { githubServer, installationHandlers, TEST_APP } from '../fakes/github-app.js'

const server = githubServer()
const api = new GitHubApi()
const numbers = z.array(z.number())

describe('GitHubApi', () => {
  it('sends the GitHub API headers and validates the response', async () => {
    let seen: Headers | undefined
    server.use(
      http.get('https://api.github.com/user', ({ request }) => {
        seen = request.headers
        return HttpResponse.json({ login: 'alice' })
      }),
    )
    const user = await api.json({ path: '/user', token: 'tok' }, z.object({ login: z.string() }))
    expect(user).toEqual({ login: 'alice' })
    expect(seen?.get('authorization')).toBe('Bearer tok')
    expect(seen?.get('accept')).toBe('application/vnd.github+json')
    expect(seen?.get('x-github-api-version')).toBe('2022-11-28')
  })

  it('maps 404 to null, 5xx to GitHubUnavailableError and other failures to GitHubHttpError', async () => {
    server.use(
      http.get('https://api.github.com/missing', () => new HttpResponse(null, { status: 404 })),
      http.get('https://api.github.com/broken', () => new HttpResponse(null, { status: 502 })),
      http.get('https://api.github.com/refused', () => new HttpResponse(null, { status: 422 })),
    )
    expect(await api.jsonOrNull({ path: '/missing' }, numbers)).toBeNull()
    await expect(api.json({ path: '/broken' }, numbers)).rejects.toThrow(
      new GitHubUnavailableError('GitHub GET /broken failed: 502'),
    )
    await expect(api.json({ path: '/refused' }, numbers)).rejects.toBeInstanceOf(GitHubHttpError)
    await expect(api.json({ path: '/refused' }, numbers)).rejects.toMatchObject({ status: 422 })
  })

  it('times out while reading a body that never ends', async () => {
    const stalled = new GitHubApi(((_url: string, init: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          init.signal?.addEventListener('abort', () => controller.error(init.signal?.reason))
        },
      })
      return Promise.resolve(new Response(body, { status: 200 }))
    }) as unknown as typeof fetch)
    await expect(stalled.json({ path: '/stalled', timeoutMs: 20 }, numbers)).rejects.toThrow(
      new GitHubUnavailableError('GitHub GET /stalled failed: TimeoutError'),
    )
  })

  it('gives up after its timeout and on network failures, never echoing the query', async () => {
    const hanging = new GitHubApi(
      ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        })) as unknown as typeof fetch,
    )
    await expect(hanging.json({ path: '/slow', timeoutMs: 20 }, numbers)).rejects.toThrow(
      new GitHubUnavailableError('GitHub GET /slow failed: TimeoutError'),
    )
    const offline = new GitHubApi((async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch)
    await expect(offline.json({ path: '/x?code=SECRET' }, numbers)).rejects.toThrow(
      new GitHubUnavailableError('GitHub GET /x failed: TypeError'),
    )
  })

  it('turns rate limits into GitHubRateLimitedError, but not plain 403s', async () => {
    const reset = Math.floor(Date.now() / 1000) + 120
    server.use(
      http.get(
        'https://api.github.com/primary',
        () =>
          new HttpResponse(null, {
            status: 403,
            headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
          }),
      ),
      http.get(
        'https://api.github.com/secondary',
        () => new HttpResponse(null, { status: 429, headers: { 'retry-after': '30' } }),
      ),
      http.get('https://api.github.com/denied', () => new HttpResponse(null, { status: 403 })),
    )
    await expect(api.send({ path: '/primary' })).rejects.toBeInstanceOf(GitHubRateLimitedError)
    await expect(api.send({ path: '/secondary' })).rejects.toMatchObject({ retryAfterSeconds: 30 })
    expect((await api.send({ path: '/denied' })).status).toBe(403)
  })

  it('follows pagination links, only on api.github.com', async () => {
    const pages: string[] = []
    server.use(
      http.get('https://api.github.com/items', ({ request }) => {
        const url = new URL(request.url)
        pages.push(url.search)
        return url.searchParams.get('page') === '2'
          ? HttpResponse.json([3])
          : HttpResponse.json([1, 2], {
              headers: {
                link: '<https://api.github.com/items?per_page=100&page=2>; rel="next", <https://api.github.com/items?per_page=100&page=2>; rel="last"',
              },
            })
      }),
      http.get('https://api.github.com/leak', () =>
        HttpResponse.json([1], { headers: { link: '<https://evil.example/steal>; rel="next"' } }),
      ),
    )
    expect(await api.paginate({ path: '/items' }, numbers, (page) => page)).toEqual({
      items: [1, 2, 3],
      truncated: false,
    })
    expect(pages).toEqual(['?per_page=100', '?per_page=100&page=2'])
    await expect(
      api.paginate({ path: '/leak', token: 't' }, numbers, (page) => page),
    ).rejects.toThrow('Refusing')
  })
})

describe('GitHubApi hardening', () => {
  it('never echoes an untrusted or malformed URL (or its query) in the error', async () => {
    for (const path of [
      'https://evil.example/x?code=SECRET',
      'https://evil.example:bad/x?code=SECRET',
      'https://api.github.com:bad/x?code=SECRET',
      'https://[bad/x?code=SECRET',
      'https://api.github.com.evil.example/x?code=SECRET',
    ]) {
      const error = await api.send({ path, token: 'tok' }).catch((e: Error) => e)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toMatch(/^Refusing/)
      expect((error as Error).message).not.toMatch(/SECRET|evil|bad|tok/)
    }
  })

  it('refuses a path the URL parser would rewrite, without calling GitHub', async () => {
    for (const path of [
      '/repos/acme/pub/git/ref/heads/../../../../acme/secret',
      '/repos/acme/pub/%2e%2e/secret',
      'https://api.github.com/a/./b',
    ]) {
      await expect(api.send({ path, token: 'tok' })).rejects.toThrow(
        'Refusing to call a GitHub URL whose path changes once normalised',
      )
    }
  })

  it('still throws on error and rate-limit responses that carry a body', async () => {
    server.use(
      http.get('https://api.github.com/body-502', () => new HttpResponse('boom', { status: 502 })),
      http.get('https://api.github.com/body-404', () => new HttpResponse('nope', { status: 404 })),
      http.get(
        'https://api.github.com/body-429',
        () => new HttpResponse('slow down', { status: 429 }),
      ),
    )
    await expect(api.json({ path: '/body-502' }, numbers)).rejects.toBeInstanceOf(
      GitHubUnavailableError,
    )
    await expect(api.jsonOrNull({ path: '/body-502' }, numbers)).rejects.toBeInstanceOf(
      GitHubUnavailableError,
    )
    await expect(api.paginate({ path: '/body-502' }, numbers, (p) => p)).rejects.toBeInstanceOf(
      GitHubUnavailableError,
    )
    await expect(api.json({ path: '/body-429' }, numbers)).rejects.toBeInstanceOf(
      GitHubRateLimitedError,
    )
  })

  it('cancels the body of failed responses', async () => {
    let cancelled = 0
    const fake = (async () => {
      const body = new ReadableStream({
        cancel() {
          cancelled++
        },
      })
      return new Response(body, { status: 502 })
    }) as unknown as typeof fetch
    const local = new GitHubApi(fake)
    await expect(local.json({ path: '/x' }, numbers)).rejects.toBeInstanceOf(GitHubUnavailableError)
    await expect(local.jsonOrNull({ path: '/x' }, numbers)).rejects.toBeInstanceOf(
      GitHubUnavailableError,
    )
    await expect(local.paginate({ path: '/x' }, numbers, (p) => p)).rejects.toBeInstanceOf(
      GitHubUnavailableError,
    )
    expect(cancelled).toBe(3)
    const limited = new GitHubApi(
      (async () =>
        new Response(new ReadableStream({ cancel: () => void cancelled++ }), {
          status: 429,
        })) as unknown as typeof fetch,
    )
    await expect(limited.send({ path: '/x' })).rejects.toBeInstanceOf(GitHubRateLimitedError)
    expect(cancelled).toBe(4)
    const missing = new GitHubApi(
      (async () =>
        new Response(new ReadableStream({ cancel: () => void cancelled++ }), {
          status: 404,
        })) as unknown as typeof fetch,
    )
    expect(await missing.jsonOrNull({ path: '/x' }, numbers)).toBeNull()
    expect(cancelled).toBe(5)
  })

  it('refuses a pagination loop and truncates an endless pagination', async () => {
    server.use(
      http.get('https://api.github.com/loop', () =>
        HttpResponse.json([1], {
          headers: { link: '<https://api.github.com/loop?per_page=100>; rel="next"' },
        }),
      ),
      http.get('https://api.github.com/endless', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page') ?? '1')
        return HttpResponse.json([page], {
          headers: {
            link: `<https://api.github.com/endless?per_page=100&page=${page + 1}>; rel="next"`,
          },
        })
      }),
    )
    await expect(api.paginate({ path: '/loop' }, numbers, (p) => p)).rejects.toThrow(/loops/)
    const endless = await api.paginate({ path: '/endless' }, numbers, (p) => p)
    expect(endless.truncated).toBe(true)
    expect(endless.items).toEqual(Array.from({ length: 100 }, (_, i) => i + 1))
  })
})

describe('createAppJwt', () => {
  it('signs an RS256 JWT issued by the App, valid for 9 minutes', () => {
    const now = new Date('2026-10-10T12:00:00Z')
    const [header = '', payload = '', signature = ''] = createAppJwt(
      42,
      TEST_APP.privateKey,
      now,
    ).split('.')
    const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    const seconds = now.getTime() / 1000
    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(decode(payload)).toEqual({ iss: '42', iat: seconds - 60, exp: seconds + 540 })
    const verified = createVerify('RSA-SHA256')
      .update(`${header}.${payload}`)
      .verify(createPublicKey(TEST_APP.privateKey), Buffer.from(signature, 'base64url'))
    expect(verified).toBe(true)
  })
})

describe('InstallationTokens', () => {
  it('finds the installation of a repository and reuses its token until it nearly expires', async () => {
    const counter = { tokens: 0 }
    server.use(...installationHandlers(['acme/shop'], counter))
    let now = new Date()
    const tokens = new InstallationTokens({
      api,
      credentials: async () => TEST_APP,
      now: () => now,
    })

    expect(await tokens.tokenFor({ owner: 'Acme', name: 'Shop' })).toBe('inst-1')
    expect(await tokens.tokenFor({ owner: 'acme', name: 'shop' })).toBe('inst-1')
    expect(counter.tokens).toBe(1)

    now = new Date(now.getTime() + 56 * 60_000)
    expect(await tokens.tokenFor({ owner: 'acme', name: 'shop' })).toBe('inst-2')
    expect(await tokens.tokenFor({ owner: 'acme', name: 'other' })).toBeNull()
  })

  it('shares in-flight token and installation requests between concurrent callers', async () => {
    const counter = { tokens: 0 }
    let installationRequests = 0
    server.use(
      http.get('https://api.github.com/repos/acme/other/installation', () => {
        installationRequests++
        return new HttpResponse(null, { status: 404 })
      }),
      ...installationHandlers(['acme/shop'], counter),
    )
    const tokens = new InstallationTokens({ api, credentials: async () => TEST_APP })
    const results = await Promise.all([
      tokens.tokenFor({ owner: 'acme', name: 'shop' }),
      tokens.tokenFor({ owner: 'acme', name: 'shop' }),
      tokens.token(7),
    ])
    expect(results).toEqual(['inst-1', 'inst-1', 'inst-1'])
    expect(counter.tokens).toBe(1)
    await Promise.all([
      tokens.installationFor({ owner: 'acme', name: 'other' }),
      tokens.installationFor({ owner: 'acme', name: 'other' }),
    ])
    expect(installationRequests).toBe(1)
  })

  it('does not keep a failed in-flight request', async () => {
    let calls = 0
    server.use(
      http.post('https://api.github.com/app/installations/7/access_tokens', () => {
        calls++
        return calls === 1
          ? new HttpResponse(null, { status: 502 })
          : HttpResponse.json({
              token: 'ok',
              expires_at: new Date(Date.now() + 3_600_000).toISOString(),
            })
      }),
    )
    const tokens = new InstallationTokens({ api, credentials: async () => TEST_APP })
    await expect(tokens.token(7)).rejects.toBeInstanceOf(GitHubUnavailableError)
    expect(await tokens.token(7)).toBe('ok')
  })

  it('does not keep a failed in-flight installation lookup', async () => {
    let calls = 0
    server.use(
      http.get('https://api.github.com/repos/acme/shop/installation', () => {
        calls++
        return calls === 1 ? new HttpResponse(null, { status: 502 }) : HttpResponse.json({ id: 7 })
      }),
    )
    const tokens = new InstallationTokens({ api, credentials: async () => TEST_APP })
    await expect(tokens.installationFor({ owner: 'acme', name: 'shop' })).rejects.toBeInstanceOf(
      GitHubUnavailableError,
    )
    expect(await tokens.installationFor({ owner: 'acme', name: 'shop' })).toBe(7)
  })

  it('does not remember that the App is not installed on a repository', async () => {
    let installed = false
    server.use(
      http.get('https://api.github.com/repos/acme/shop/installation', () =>
        installed ? HttpResponse.json({ id: 7 }) : new HttpResponse(null, { status: 404 }),
      ),
      ...installationHandlers(['acme/shop']),
    )
    const tokens = new InstallationTokens({ api, credentials: async () => TEST_APP })
    expect(await tokens.tokenFor({ owner: 'acme', name: 'shop' })).toBeNull()
    installed = true
    expect(await tokens.tokenFor({ owner: 'acme', name: 'shop' })).toBe('inst-1')
  })

  it('fails clearly while the App is not configured', async () => {
    const tokens = new InstallationTokens({ api, credentials: async () => null })
    await expect(tokens.tokenFor({ owner: 'acme', name: 'shop' })).rejects.toThrow('not configured')
  })

  it('stops reading pages once the time budget is spent, and says the list is truncated', async () => {
    let now = 0
    server.use(
      http.get('https://api.github.com/slow', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page') ?? '1')
        now += 20_000
        return HttpResponse.json([page], {
          headers: {
            link: `<https://api.github.com/slow?per_page=100&page=${page + 1}>; rel="next"`,
          },
        })
      }),
    )
    const timed = new GitHubApi(undefined, () => now)
    expect(
      await timed.paginate({ path: '/slow' }, numbers, (page) => page, { budgetMs: 30_000 }),
    ).toEqual({ items: [1, 2], truncated: true })
  })
})

describe('GitHubApi origins', () => {
  const local = { api: 'http://127.0.0.1:3402', web: 'http://127.0.0.1:3402' }

  it('sends API paths and absolute URLs to the configured origins only', async () => {
    const urls: string[] = []
    const fetchStub = (async (url: string) => {
      urls.push(url)
      return Response.json({})
    }) as unknown as typeof fetch
    const api = new GitHubApi(fetchStub, undefined, local)
    await api.send({ path: '/user' })
    await api.send({ path: 'http://127.0.0.1:3402/login/oauth/access_token', method: 'POST' })
    expect(urls).toEqual([
      'http://127.0.0.1:3402/user',
      'http://127.0.0.1:3402/login/oauth/access_token',
    ])
    // Once overridden, github.com itself is no longer trusted with tokens.
    await expect(api.send({ path: 'https://api.github.com/user', token: 't' })).rejects.toThrow(
      'Refusing',
    )
  })

  it('never trusts plain HTTP with the default origins', async () => {
    await expect(new GitHubApi().send({ path: 'http://api.github.com/user' })).rejects.toThrow(
      'Refusing',
    )
  })
})
