import { HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { GitHubUnavailableError } from '../../src/application/ports/github-errors.js'
import { GitHubApi } from '../../src/infrastructure/github/github-api.js'
import { GitHubRepoDirectory } from '../../src/infrastructure/github/github-repo-directory.js'
import { githubServer } from '../fakes/github-app.js'

const server = githubServer()
const api = new GitHubApi()
const quiet = { warn: () => {} }

function userInstallations(counter: { requests: number }) {
  return [
    http.get('https://api.github.com/user/installations', () => {
      counter.requests++
      return HttpResponse.json({
        total_count: 2,
        installations: [
          { id: 1, account: { login: 'acme' } },
          { id: 2, account: { login: 'alice' } },
        ],
      })
    }),
    http.get('https://api.github.com/user/installations/:id/repositories', ({ params }) => {
      counter.requests++
      const repositories =
        params.id === '1'
          ? [
              {
                id: 11,
                name: 'shop',
                owner: { login: 'acme' },
                default_branch: 'main',
                private: true,
                permissions: { admin: false, push: true, pull: true },
              },
            ]
          : [
              {
                id: 12,
                name: 'notes',
                owner: { login: 'alice' },
                default_branch: 'trunk',
                private: false,
                permissions: { admin: false, push: false, pull: true },
              },
            ]
      return HttpResponse.json({ total_count: 1, repositories })
    }),
  ]
}

describe('GitHubRepoDirectory', () => {
  it('lists the repositories of every accessible installation, cached 5 minutes per user', async () => {
    const counter = { requests: 0 }
    server.use(...userInstallations(counter))
    let now = new Date('2026-10-10T12:00:00Z')
    const directory = new GitHubRepoDirectory({
      api,
      logger: quiet,
      accessToken: async () => 'ghu_1',
      now: () => now,
    })

    const expected = {
      accounts: ['acme', 'alice'],
      repos: [
        {
          id: 11,
          owner: 'acme',
          name: 'shop',
          defaultBranch: 'main',
          private: true,
          canWrite: true,
        },
        {
          id: 12,
          owner: 'alice',
          name: 'notes',
          defaultBranch: 'trunk',
          private: false,
          canWrite: false,
        },
      ],
    }
    expect(await directory.forUser('1')).toEqual(expected)
    expect(counter.requests).toBe(3)
    expect(await directory.forUser('1')).toEqual(expected)
    expect(counter.requests).toBe(3)

    now = new Date(now.getTime() + 5 * 60_000)
    // Past the TTL the previous list answers at once and is refreshed behind it.
    expect(await directory.forUser('1')).toEqual(expected)
    await vi.waitFor(() => expect(counter.requests).toBe(6))
  })

  it('shares the in-flight load between concurrent cache misses of one user', async () => {
    const counter = { requests: 0 }
    server.use(...userInstallations(counter))
    const directory = new GitHubRepoDirectory({
      api,
      logger: quiet,
      accessToken: async () => 'ghu_1',
    })
    const [first, second] = await Promise.all([directory.forUser('1'), directory.forUser('1')])
    expect(first).toEqual(second)
    expect(counter.requests).toBe(3)
  })

  it('does not keep a failed in-flight load', async () => {
    const counter = { requests: 0 }
    let fail = true
    server.use(
      http.get('https://api.github.com/user/installations', () =>
        fail ? new HttpResponse(null, { status: 502 }) : undefined,
      ),
      ...userInstallations(counter),
    )
    const directory = new GitHubRepoDirectory({
      api,
      logger: quiet,
      accessToken: async () => 'ghu_1',
    })
    await expect(directory.forUser('1')).rejects.toBeInstanceOf(GitHubUnavailableError)
    fail = false
    expect((await directory.forUser('1'))?.accounts).toEqual(['acme', 'alice'])
  })

  it('prunes entries of other users older than an hour when it writes the cache', async () => {
    const counter = { requests: 0 }
    server.use(...userInstallations(counter))
    let now = new Date('2026-10-10T12:00:00Z')
    const directory = new GitHubRepoDirectory({
      api,
      logger: quiet,
      accessToken: async () => 'ghu_1',
      now: () => now,
    })
    await directory.forUser('1')
    now = new Date(now.getTime() + 61 * 60_000)
    await directory.forUser('2')
    expect((directory as unknown as { cache: Map<string, unknown> }).cache.has('1')).toBe(false)
  })

  it('serves the previous list at once while it refreshes it', async () => {
    const counter = { requests: 0 }
    server.use(...userInstallations(counter))
    let now = new Date('2026-10-10T12:00:00Z')
    const directory = new GitHubRepoDirectory({
      api,
      logger: quiet,
      accessToken: async () => 'ghu_1',
      now: () => now,
    })
    const first = await directory.forUser('1')
    now = new Date(now.getTime() + 6 * 60_000)

    expect(await directory.forUser('1')).toBe(first)
    await vi.waitFor(() => expect(counter.requests).toBe(6))
    expect(await directory.forUser('1')).not.toBe(first)
    expect(counter.requests).toBe(6)
  })

  it('keeps the previous list, with a warning, when GitHub fails to refresh it', async () => {
    const counter = { requests: 0 }
    let fail = false
    server.use(
      http.get('https://api.github.com/user/installations', () =>
        fail ? new HttpResponse(null, { status: 502 }) : undefined,
      ),
      ...userInstallations(counter),
    )
    const warnings: string[] = []
    let now = new Date('2026-10-10T12:00:00Z')
    const directory = new GitHubRepoDirectory({
      api,
      logger: { warn: (_details, message) => warnings.push(message) },
      accessToken: async () => 'ghu_1',
      now: () => now,
    })
    const first = await directory.forUser('1')
    now = new Date(now.getTime() + 6 * 60_000)
    fail = true

    expect(await directory.forUser('1')).toBe(first)
    await vi.waitFor(() =>
      expect(warnings).toEqual([
        'Could not refresh the repositories of a user: the previous list is kept',
      ]),
    )
    expect(await directory.forUser('1')).toBe(first)
  })

  it('awaits the reload of a list older than the TTL when the read must be fresh', async () => {
    let accounts = [{ id: 1, account: { login: 'acme' } }]
    server.use(
      http.get('https://api.github.com/user/installations', () =>
        HttpResponse.json({ total_count: accounts.length, installations: accounts }),
      ),
      http.get('https://api.github.com/user/installations/:id/repositories', () =>
        HttpResponse.json({ total_count: 0, repositories: [] }),
      ),
    )
    let now = new Date('2026-10-10T12:00:00Z')
    const directory = new GitHubRepoDirectory({
      api,
      logger: quiet,
      accessToken: async () => 'ghu_1',
      now: () => now,
    })
    expect((await directory.forUser('1'))?.accounts).toEqual(['acme'])
    accounts = [{ id: 2, account: { login: 'elsewhere' } }]
    now = new Date(now.getTime() + 10 * 60_000)

    expect((await directory.forUser('1', { fresh: true }))?.accounts).toEqual(['elsewhere'])
  })

  it('fails a fresh read when GitHub is unavailable, while a plain read keeps the previous list', async () => {
    const counter = { requests: 0 }
    let fail = false
    server.use(
      http.get('https://api.github.com/user/installations', () =>
        fail ? new HttpResponse(null, { status: 500 }) : undefined,
      ),
      ...userInstallations(counter),
    )
    let now = new Date('2026-10-10T12:00:00Z')
    const directory = new GitHubRepoDirectory({
      api,
      logger: quiet,
      accessToken: async () => 'ghu_1',
      now: () => now,
    })
    const first = await directory.forUser('1')
    now = new Date(now.getTime() + 10 * 60_000)
    fail = true

    await expect(directory.forUser('1', { fresh: true })).rejects.toBeInstanceOf(
      GitHubUnavailableError,
    )
    expect(await directory.forUser('1')).toBe(first)
  })

  it('fails a fresh read that shares the in-flight refresh of a plain read', async () => {
    const counter = { requests: 0 }
    server.use(...userInstallations(counter))
    let now = new Date('2026-10-10T12:00:00Z')
    const directory = new GitHubRepoDirectory({
      api,
      logger: quiet,
      accessToken: async () => 'ghu_1',
      now: () => now,
    })
    const first = await directory.forUser('1')
    now = new Date(now.getTime() + 10 * 60_000)
    server.use(
      http.get(
        'https://api.github.com/user/installations',
        () => new HttpResponse(null, { status: 500 }),
      ),
    )
    const plain = directory.forUser('1')
    const fresh = directory.forUser('1', { fresh: true })
    expect(await plain).toBe(first)
    await expect(fresh).rejects.toBeInstanceOf(GitHubUnavailableError)
  })

  it('waits for the load when the previous list is more than an hour old', async () => {
    const counter = { requests: 0 }
    let fail = false
    server.use(
      http.get('https://api.github.com/user/installations', () =>
        fail ? new HttpResponse(null, { status: 502 }) : undefined,
      ),
      ...userInstallations(counter),
    )
    let now = new Date('2026-10-10T12:00:00Z')
    const directory = new GitHubRepoDirectory({
      api,
      logger: quiet,
      accessToken: async () => 'ghu_1',
      now: () => now,
    })
    await directory.forUser('1')
    now = new Date(now.getTime() + 61 * 60_000)
    fail = true
    await expect(directory.forUser('1')).rejects.toBeInstanceOf(GitHubUnavailableError)
  })

  it('reads the installations in parallel', { timeout: 5_000 }, async () => {
    let arrived = 0
    let release = () => {}
    const bothArrived = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get('https://api.github.com/user/installations', () =>
        HttpResponse.json({
          installations: [
            { id: 1, account: { login: 'acme' } },
            { id: 2, account: { login: 'alice' } },
          ],
        }),
      ),
      http.get('https://api.github.com/user/installations/:id/repositories', async () => {
        arrived++
        if (arrived === 2) release()
        // A sequential load would wait here forever for the second request.
        await bothArrived
        return HttpResponse.json({ repositories: [] })
      }),
    )
    const directory = new GitHubRepoDirectory({
      api,
      logger: quiet,
      accessToken: async () => 'ghu_1',
    })
    expect(await directory.forUser('1')).toEqual({ accounts: ['acme', 'alice'], repos: [] })
  })

  it('warns when an installation lists more repositories than it reads', async () => {
    server.use(
      http.get('https://api.github.com/user/installations', () =>
        HttpResponse.json({ installations: [{ id: 1, account: { login: 'acme' } }] }),
      ),
      http.get('https://api.github.com/user/installations/1/repositories', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page') ?? '1')
        return HttpResponse.json(
          {
            repositories: [
              {
                id: 1000 + page,
                name: `r${page}`,
                owner: { login: 'acme' },
                default_branch: 'main',
                private: true,
              },
            ],
          },
          {
            headers: {
              link: `<https://api.github.com/user/installations/1/repositories?per_page=100&page=${page + 1}>; rel="next"`,
            },
          },
        )
      }),
    )
    const warnings: string[] = []
    const directory = new GitHubRepoDirectory({
      api,
      logger: { warn: (_details, message) => warnings.push(message) },
      accessToken: async () => 'ghu_1',
    })
    expect((await directory.forUser('1'))?.repos).toHaveLength(100)
    expect(warnings).toEqual([
      'GitHub lists more repositories than RepoERD reads for an installation: the list is truncated',
    ])
  })

  it('returns null when a per-installation repositories call is rejected with 401', async () => {
    server.use(
      http.get('https://api.github.com/user/installations', () =>
        HttpResponse.json({ total_count: 1, installations: [{ id: 1, account: null }] }),
      ),
      http.get(
        'https://api.github.com/user/installations/1/repositories',
        () => new HttpResponse(null, { status: 401 }),
      ),
    )
    expect(
      await new GitHubRepoDirectory({
        api,
        logger: quiet,
        accessToken: async () => 'revoked',
      }).forUser('1'),
    ).toBeNull()
  })

  it('forgets every list when the App changes, and does not keep a load that was running', async () => {
    const counter = { requests: 0 }
    server.use(...userInstallations(counter))
    const directory = new GitHubRepoDirectory({
      api,
      logger: quiet,
      accessToken: async () => 'ghu_1',
    })
    await directory.forUser('1')
    expect(counter.requests).toBe(3)
    directory.forgetAll()
    await directory.forUser('1')
    expect(counter.requests).toBe(6)

    const running = directory.forUser('2')
    directory.forgetAll()
    expect(await running).toMatchObject({ accounts: ['acme', 'alice'] })
    await directory.forUser('2')
    expect(counter.requests).toBe(12)

    // A call right after forgetAll starts its own load, and only that one is cached.
    const old = directory.forUser('3')
    directory.forgetAll()
    const renewed = directory.forUser('3')
    await Promise.all([old, renewed])
    expect(counter.requests).toBe(18)
    await directory.forUser('3')
    expect(counter.requests).toBe(18)
  })

  it('returns null without a usable user token or when GitHub rejects it', async () => {
    expect(
      await new GitHubRepoDirectory({ api, logger: quiet, accessToken: async () => null }).forUser(
        '1',
      ),
    ).toBeNull()

    server.use(
      http.get(
        'https://api.github.com/user/installations',
        () => new HttpResponse(null, { status: 401 }),
      ),
    )
    expect(
      await new GitHubRepoDirectory({
        api,
        logger: quiet,
        accessToken: async () => 'revoked',
      }).forUser('1'),
    ).toBeNull()
  })

  it('asks GitHub where an old name leads, with the user token, and remembers the answer', async () => {
    let lookups = 0
    server.use(
      http.get('https://api.github.com/repos/acme/old-shop', ({ request }) => {
        lookups++
        expect(request.headers.get('authorization')).toBe('Bearer ghu_1')
        return HttpResponse.json({ id: 11, name: 'shop', owner: { login: 'acme' } })
      }),
      http.get('https://api.github.com/repos/acme/ghost', () => {
        lookups++
        return new HttpResponse(null, { status: 404 })
      }),
    )
    const directory = new GitHubRepoDirectory({
      api,
      logger: quiet,
      accessToken: async () => 'ghu_1',
    })
    expect(await directory.findMoved('1', { owner: 'acme', name: 'old-shop' })).toEqual({
      id: 11,
      owner: 'acme',
      name: 'shop',
    })
    expect(await directory.findMoved('1', { owner: 'ACME', name: 'Old-Shop' })).toEqual({
      id: 11,
      owner: 'acme',
      name: 'shop',
    })
    expect(await directory.findMoved('1', { owner: 'acme', name: 'ghost' })).toBeNull()
    expect(await directory.findMoved('1', { owner: 'acme', name: 'ghost' })).toBeNull()
    expect(lookups).toBe(2)
  })

  it('follows the 301 GitHub answers for a renamed repository, keeping the token', async () => {
    const tokens: (string | null)[] = []
    server.use(
      http.get(
        'https://api.github.com/repos/acme/old-shop',
        () =>
          new HttpResponse(null, {
            status: 301,
            headers: { location: 'https://api.github.com/repositories/11' },
          }),
      ),
      http.get('https://api.github.com/repositories/11', ({ request }) => {
        tokens.push(request.headers.get('authorization'))
        return HttpResponse.json({ id: 11, name: 'shop-v2', owner: { login: 'Acme' } })
      }),
    )
    const directory = new GitHubRepoDirectory({
      api,
      logger: quiet,
      accessToken: async () => 'ghu_1',
    })
    expect(await directory.findMoved('1', { owner: 'acme', name: 'old-shop' })).toEqual({
      id: 11,
      owner: 'Acme',
      name: 'shop-v2',
    })
    expect(tokens).toEqual(['Bearer ghu_1'])
  })

  it('answers null when the token cannot be obtained, and shares concurrent lookups', async () => {
    const warnings: unknown[] = []
    let lookups = 0
    server.use(
      http.get('https://api.github.com/repos/acme/old-shop', async () => {
        lookups++
        await new Promise((resolve) => setTimeout(resolve, 20))
        return HttpResponse.json({ id: 11, name: 'shop', owner: { login: 'acme' } })
      }),
    )
    const broken = new GitHubRepoDirectory({
      api,
      logger: { warn: (...args: unknown[]) => warnings.push(args) },
      accessToken: async () => {
        throw new Error('refresh failed')
      },
    })
    expect(await broken.findMoved('1', { owner: 'acme', name: 'old-shop' })).toBeNull()
    expect(warnings).toHaveLength(1)
    const directory = new GitHubRepoDirectory({
      api,
      logger: quiet,
      accessToken: async () => 'ghu_1',
    })
    const lookup = { owner: 'acme', name: 'old-shop' }
    const answers = await Promise.all([
      directory.findMoved('1', lookup),
      directory.findMoved('1', lookup),
      directory.findMoved('1', lookup),
    ])
    expect(answers.map((answer) => answer?.id)).toEqual([11, 11, 11])
    expect(lookups).toBe(1)
  })

  it('answers no move when GitHub fails, without remembering it', async () => {
    let fail = true
    server.use(
      http.get('https://api.github.com/repos/acme/old-shop', () =>
        fail
          ? new HttpResponse(null, { status: 502 })
          : HttpResponse.json({ id: 11, name: 'shop', owner: { login: 'acme' } }),
      ),
    )
    const directory = new GitHubRepoDirectory({
      api,
      logger: quiet,
      accessToken: async () => 'ghu_1',
    })
    expect(await directory.findMoved('1', { owner: 'acme', name: 'old-shop' })).toBeNull()
    fail = false
    expect(await directory.findMoved('1', { owner: 'acme', name: 'old-shop' })).toEqual({
      id: 11,
      owner: 'acme',
      name: 'shop',
    })
  })

  it('reloads the list on demand, at most once a minute per user', async () => {
    const counter = { requests: 0 }
    server.use(...userInstallations(counter))
    let now = new Date('2026-10-10T12:00:00Z')
    const directory = new GitHubRepoDirectory({
      api,
      logger: quiet,
      accessToken: async () => 'ghu_1',
      now: () => now,
    })
    await directory.forUser('1')
    expect(counter.requests).toBe(3)
    await directory.forUser('1', { refresh: true })
    expect(counter.requests).toBe(6)
    now = new Date(now.getTime() + 30_000)
    await directory.forUser('1', { refresh: true })
    expect(counter.requests).toBe(6)
    now = new Date(now.getTime() + 30_000)
    await directory.forUser('1', { refresh: true })
    expect(counter.requests).toBe(9)
  })

  it('waits longer and longer before refreshing again while GitHub fails, serving the previous list', async () => {
    const counter = { requests: 0 }
    let fail = false
    server.use(
      http.get('https://api.github.com/user/installations', () =>
        fail ? new HttpResponse(null, { status: 502 }) : undefined,
      ),
      ...userInstallations(counter),
    )
    const warnings: string[] = []
    let now = new Date('2026-10-10T12:00:00Z')
    const later = (ms: number) => {
      now = new Date(now.getTime() + ms)
    }
    const directory = new GitHubRepoDirectory({
      api,
      logger: { warn: (_details, message) => warnings.push(message) },
      accessToken: async () => 'ghu_1',
      now: () => now,
    })
    const first = await directory.forUser('1')
    fail = true
    later(5 * 60_000)
    expect(await directory.forUser('1')).toEqual(first)
    await vi.waitFor(() => expect(warnings).toHaveLength(1))
    // Within the 30 s backoff: the previous list, without asking GitHub.
    later(29_000)
    expect(await directory.forUser('1')).toEqual(first)
    expect(warnings).toHaveLength(1)
    // Past it: one more try, which fails; the next wait is 60 s.
    later(2_000)
    await directory.forUser('1')
    await vi.waitFor(() => expect(warnings).toHaveLength(2))
    later(59_000)
    await directory.forUser('1')
    expect(warnings).toHaveLength(2)
    // GitHub answers again: the list is refreshed and the backoff forgotten.
    fail = false
    later(2_000)
    await directory.forUser('1')
    await vi.waitFor(() => expect(counter.requests).toBe(6))
  })

  it('never lets the backoff serve a stale list to a fresh read, and a success ends it', async () => {
    const counter = { requests: 0 }
    let fail = false
    server.use(
      http.get('https://api.github.com/user/installations', () =>
        fail ? new HttpResponse(null, { status: 502 }) : undefined,
      ),
      ...userInstallations(counter),
    )
    const warnings: string[] = []
    let now = new Date('2026-10-10T12:00:00Z')
    const later = (ms: number) => {
      now = new Date(now.getTime() + ms)
    }
    const directory = new GitHubRepoDirectory({
      api,
      logger: { warn: (_details, message) => warnings.push(message) },
      accessToken: async () => 'ghu_1',
      now: () => now,
    })
    await directory.forUser('1')
    fail = true
    later(5 * 60_000)
    await directory.forUser('1')
    await vi.waitFor(() => expect(warnings).toHaveLength(1))
    // In backoff: a fresh read still asks GitHub, and fails closed.
    later(1_000)
    await expect(directory.forUser('1', { fresh: true })).rejects.toBeInstanceOf(
      GitHubUnavailableError,
    )
    // GitHub is back: a fresh read succeeds and resets the backoff.
    fail = false
    later(1_000)
    const before = counter.requests
    await directory.forUser('1', { fresh: true })
    expect(counter.requests).toBe(before + 3)
    // Stale again, one failure, then a plain read 31 s later tries at once (30 s, not more).
    later(5 * 60_000)
    fail = true
    await directory.forUser('1')
    await vi.waitFor(() => expect(warnings).toHaveLength(2))
    fail = false
    later(31_000)
    const afterFailure = counter.requests
    await directory.forUser('1')
    await vi.waitFor(() => expect(counter.requests).toBe(afterFailure + 3))
  })

  it('counts one failed background refresh once, however many reads shared it', async () => {
    const counter = { requests: 0 }
    let fail = false
    server.use(
      http.get('https://api.github.com/user/installations', () =>
        fail ? new HttpResponse(null, { status: 502 }) : undefined,
      ),
      ...userInstallations(counter),
    )
    const warnings: string[] = []
    let now = new Date('2026-10-10T12:00:00Z')
    const directory = new GitHubRepoDirectory({
      api,
      logger: { warn: (_details, message) => warnings.push(message) },
      accessToken: async () => 'ghu_1',
      now: () => now,
    })
    await directory.forUser('1')
    fail = true
    now = new Date(now.getTime() + 5 * 60_000)
    await Promise.all([directory.forUser('1'), directory.forUser('1'), directory.forUser('1')])
    await vi.waitFor(() => expect(warnings).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(warnings).toHaveLength(1)
    // One failure: the wait is 30 s, not 120 s.
    fail = false
    now = new Date(now.getTime() + 31_000)
    await directory.forUser('1')
    await vi.waitFor(() => expect(counter.requests).toBe(6))
  })
})
