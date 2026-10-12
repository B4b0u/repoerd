import { HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { GitHubRateLimitedError } from '../../src/application/ports/github-errors.js'
import {
  GitHubApi,
  type GitHubRequest,
  GRAPHQL_TIMEOUT_MS,
  REST_TIMEOUT_MS,
} from '../../src/infrastructure/github/github-api.js'
import {
  BRANCH_LIST_BUDGET_MS,
  GitHubGitHost,
} from '../../src/infrastructure/github/github-git-host.js'
import { InstallationTokens } from '../../src/infrastructure/github/installation-tokens.js'
import { githubServer, installationHandlers, TEST_APP } from '../fakes/github-app.js'

const server = githubServer()
const repo = { owner: 'acme', name: 'shop' }
const sha = (n: number) => n.toString(16).padStart(40, '0')

function gitHost(options: { mergeBaseCacheSize?: number; now?: () => number } = {}) {
  const warnings: string[] = []
  const details: unknown[] = []
  const api = new GitHubApi()
  const host = new GitHubGitHost({
    api,
    installations: new InstallationTokens({ api, credentials: async () => TEST_APP }),
    logger: {
      warn: (info, message) => {
        details.push(info)
        warnings.push(message)
      },
    },
    ...options,
  })
  return { host, warnings, details, api }
}

describe('GitHubGitHost', () => {
  it('reads the repository, every page of branches and branches with slashes', async () => {
    const refs: string[] = []
    server.use(
      ...installationHandlers(['acme/shop']),
      http.get('https://api.github.com/repos/acme/shop', () =>
        HttpResponse.json({
          id: 1,
          name: 'shop',
          owner: { login: 'acme' },
          default_branch: 'main',
          private: true,
        }),
      ),
      http.get('https://api.github.com/repos/acme/shop/branches', ({ request }) =>
        new URL(request.url).searchParams.get('page') === '2'
          ? HttpResponse.json([{ name: 'feature/odd#1+é', commit: { sha: sha(2) } }])
          : HttpResponse.json([{ name: 'main', commit: { sha: sha(1) } }], {
              headers: {
                link: '<https://api.github.com/repos/acme/shop/branches?per_page=100&page=2>; rel="next"',
              },
            }),
      ),
      http.get('https://api.github.com/repos/acme/shop/git/ref/*', ({ request }) => {
        const path = new URL(request.url).pathname
        refs.push(path)
        return path.endsWith('/heads/feature/odd%231%2B%C3%A9')
          ? HttpResponse.json({
              ref: 'refs/heads/feature/odd#1+é',
              object: { sha: sha(2), type: 'commit' },
            })
          : new HttpResponse(null, { status: 404 })
      }),
    )
    const { host } = gitHost()

    expect(await host.getRepository(repo)).toEqual({
      id: 1,
      owner: 'acme',
      name: 'shop',
      defaultBranch: 'main',
      private: true,
    })
    expect(await host.listBranches(repo)).toEqual({
      branches: [
        { name: 'main', commitSha: sha(1) },
        { name: 'feature/odd#1+é', commitSha: sha(2) },
      ],
      truncated: false,
    })
    expect(await host.resolveBranch(repo, 'feature/odd#1+é')).toBe(sha(2))
    expect(refs[0]).toBe('/repos/acme/shop/git/ref/heads/feature/odd%231%2B%C3%A9')
    expect(await host.resolveBranch(repo, 'missing')).toBeNull()
  })

  it('encodes literal % and # in branch names', async () => {
    const paths: string[] = []
    server.use(
      ...installationHandlers(['acme/shop']),
      http.get('https://api.github.com/repos/acme/shop/git/ref/*', ({ request }) => {
        paths.push(new URL(request.url).pathname + new URL(request.url).search)
        return HttpResponse.json({ object: { sha: sha(3), type: 'commit' } })
      }),
    )
    const { host } = gitHost()
    expect(await host.resolveBranch(repo, 'release/100%#x')).toBe(sha(3))
    expect(paths).toEqual(['/repos/acme/shop/git/ref/heads/release/100%25%23x'])
  })

  it('never lets a branch name reach another GitHub endpoint', async () => {
    server.use(...installationHandlers(['acme/shop']))
    const { host } = gitHost()
    // No handler for the ref: a request would fail the test (msw refuses unhandled requests).
    await expect(
      host.resolveBranch(repo, '../../../../acme/secret/git/ref/heads/main'),
    ).rejects.toThrow('Refusing to call a GitHub URL whose path changes once normalised')
  })

  it('reads at most 100 pages of branches and warns that the list is truncated', async () => {
    server.use(
      ...installationHandlers(['acme/shop']),
      http.get('https://api.github.com/repos/acme/shop/branches', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page') ?? '1')
        return HttpResponse.json([{ name: `b${page}`, commit: { sha: sha(page) } }], {
          headers: {
            link: `<https://api.github.com/repos/acme/shop/branches?per_page=100&page=${page + 1}>; rel="next"`,
          },
        })
      }),
    )
    const { host, warnings } = gitHost()
    const page = await host.listBranches(repo)
    expect(page.branches).toHaveLength(100)
    expect(page.truncated).toBe(true)
    expect(warnings).toEqual([
      'GitHub lists more branches than RepoERD reads: the branch list is truncated',
    ])
  })

  it('gives GraphQL blob batches 60 s and REST calls 20 s', async () => {
    server.use(
      ...installationHandlers(['acme/shop']),
      http.get('https://api.github.com/repos/acme/shop/branches', () => HttpResponse.json([])),
      http.post('https://api.github.com/graphql', () =>
        HttpResponse.json({
          data: { repository: { b0: { text: 'x', isBinary: false, isTruncated: false } } },
        }),
      ),
    )
    const { host, api } = gitHost()
    const timeouts = new Map<string, number | undefined>()
    const send = api.send.bind(api)
    vi.spyOn(api, 'send').mockImplementation((request: GitHubRequest) => {
      timeouts.set(request.path, request.timeoutMs)
      return send(request)
    })
    await host.getBlobs(repo, [sha(5)])
    await host.listBranches(repo)
    expect(timeouts.get('/graphql')).toBe(GRAPHQL_TIMEOUT_MS)
    expect(GRAPHQL_TIMEOUT_MS).toBe(60_000)
    expect(timeouts.get('/repos/acme/shop/branches?per_page=100')).toBeUndefined()
    expect(REST_TIMEOUT_MS).toBe(20_000)
  })

  it('forgets a refused installation token and retries once with a fresh one', async () => {
    const counter = { tokens: 0 }
    server.use(
      ...installationHandlers(['acme/shop'], counter),
      http.get('https://api.github.com/repos/acme/shop', ({ request }) =>
        request.headers.get('authorization') === 'Bearer inst-1'
          ? new HttpResponse(null, { status: 401 })
          : HttpResponse.json({
              id: 1,
              name: 'shop',
              owner: { login: 'acme' },
              default_branch: 'main',
              private: false,
            }),
      ),
    )
    const { host } = gitHost()
    expect(await host.getRepository(repo)).toMatchObject({ name: 'shop' })
    expect(counter.tokens).toBe(2)
  })

  it('gives up after one retry when GitHub keeps refusing the token', async () => {
    const counter = { tokens: 0 }
    server.use(
      ...installationHandlers(['acme/shop'], counter),
      http.get(
        'https://api.github.com/repos/acme/shop',
        () => new HttpResponse(null, { status: 401 }),
      ),
    )
    const { host } = gitHost()
    await expect(host.getRepository(repo)).rejects.toMatchObject({ status: 401 })
    expect(counter.tokens).toBe(2)
  })

  it('knows nothing about repositories the App is not installed on', async () => {
    server.use(...installationHandlers([]))
    const { host } = gitHost()
    expect(await host.getRepository(repo)).toBeNull()
    expect(await host.listBranches(repo)).toEqual({ branches: [], truncated: false })
    expect(await host.resolveBranch(repo, 'main')).toBeNull()
  })

  it('lists the blobs of the recursive tree and warns when GitHub truncated it', async () => {
    let recursive: string | null = null
    server.use(
      ...installationHandlers(['acme/shop']),
      http.get(`https://api.github.com/repos/acme/shop/git/trees/${sha(1)}`, ({ request }) => {
        recursive = new URL(request.url).searchParams.get('recursive')
        return HttpResponse.json({
          sha: sha(1),
          truncated: true,
          tree: [
            { path: 'prisma', mode: '040000', type: 'tree', sha: sha(3) },
            { path: 'prisma/schema.prisma', mode: '100644', type: 'blob', sha: sha(4), size: 12 },
            { path: 'vendor/lib', mode: '160000', type: 'commit', sha: sha(5) },
          ],
        })
      }),
    )
    const { host, warnings } = gitHost()
    expect(await host.getTree(repo, sha(1))).toEqual({
      truncated: true,
      entries: [{ path: 'prisma/schema.prisma', sha: sha(4), size: 12 }],
    })
    expect(recursive).toBe('1')
    expect(warnings).toHaveLength(1)
  })

  it('fetches blobs in GraphQL batches of 100 and re-reads truncated ones through REST', async () => {
    const batches: number[] = []
    const queries: string[] = []
    let authorization: string | null = null
    server.use(
      ...installationHandlers(['acme/shop']),
      http.post('https://api.github.com/graphql', async ({ request }) => {
        authorization = request.headers.get('authorization')
        const { query, variables } = (await request.json()) as {
          query: string
          variables: Record<string, string>
        }
        queries.push(query)
        const oids = Object.entries(variables).filter(([key]) => /^o\d+$/.test(key))
        batches.push(oids.length)
        const blob = (oid: string) => {
          if (oid === sha(0)) return { text: 'partial', isBinary: false, isTruncated: true }
          if (oid === sha(1)) return { text: null, isBinary: true, isTruncated: false }
          return { text: `content ${oid}`, isBinary: false, isTruncated: false }
        }
        const repository = Object.fromEntries(
          oids.map(([key, oid]) => [`b${key.slice(1)}`, blob(oid)]),
        )
        return HttpResponse.json({ data: { repository } })
      }),
      http.get(`https://api.github.com/repos/acme/shop/git/blobs/${sha(0)}`, () =>
        HttpResponse.json({
          sha: sha(0),
          content: Buffer.from('full content').toString('base64'),
          encoding: 'base64',
        }),
      ),
    )
    const { host } = gitHost()
    const blobs = await host.getBlobs(
      repo,
      Array.from({ length: 150 }, (_, i) => sha(i)),
    )

    expect(batches).toEqual([100, 50])
    expect(queries[0]).toContain('$o0: GitObjectID!')
    expect(queries[0]).not.toContain(sha(2))
    expect(blobs.size).toBe(150)
    expect(blobs.get(sha(0))).toBe('full content')
    expect(blobs.get(sha(1))).toBe('')
    expect(blobs.get(sha(149))).toBe(`content ${sha(149)}`)
    expect(authorization).toBe('Bearer inst-1')
  })

  it('re-reads several truncated blobs of one batch through REST in parallel', async () => {
    let inFlight = 0
    let peak = 0
    server.use(
      ...installationHandlers(['acme/shop']),
      http.post('https://api.github.com/graphql', async ({ request }) => {
        const { variables } = (await request.json()) as { variables: Record<string, string> }
        const oids = Object.entries(variables).filter(([key]) => /^o\d+$/.test(key))
        const repository = Object.fromEntries(
          oids.map(([key]) => [`b${key.slice(1)}`, { text: 'partial', isTruncated: true }]),
        )
        return HttpResponse.json({ data: { repository } })
      }),
      http.get('https://api.github.com/repos/acme/shop/git/blobs/:sha', async ({ params }) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 20))
        inFlight--
        return HttpResponse.json({
          content: Buffer.from(`full ${params.sha}`).toString('base64'),
          encoding: 'base64',
        })
      }),
    )
    const { host } = gitHost()
    const blobs = await host.getBlobs(repo, [sha(1), sha(2), sha(3)])
    expect(peak).toBeGreaterThan(1)
    peak = 0
    const many = Array.from({ length: 25 }, (_, i) => sha(i + 10))
    const all = await host.getBlobs(repo, many)
    expect(peak).toBeLessThanOrEqual(10)
    expect([...all.keys()]).toEqual(many)
    expect([...blobs.entries()]).toEqual([
      [sha(1), `full ${sha(1)}`],
      [sha(2), `full ${sha(2)}`],
      [sha(3), `full ${sha(3)}`],
    ])
    expect(peak).toBeGreaterThan(1)
  })

  it('reports GraphQL rate limits as GitHubRateLimitedError', async () => {
    server.use(
      ...installationHandlers(['acme/shop']),
      http.post('https://api.github.com/graphql', () =>
        HttpResponse.json({
          errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }],
        }),
      ),
    )
    await expect(gitHost().host.getBlobs(repo, [sha(1)])).rejects.toBeInstanceOf(
      GitHubRateLimitedError,
    )
  })
})

describe('GitHubGitHost.getMergeBase', () => {
  const compareUrl = 'https://api.github.com/repos/acme/shop/compare/:range'

  it('reads the merge base once per pair of commits', async () => {
    const requests: string[] = []
    server.use(
      ...installationHandlers(['acme/shop']),
      http.get(compareUrl, ({ request }) => {
        const url = new URL(request.url)
        requests.push(url.pathname + url.search)
        return HttpResponse.json({ merge_base_commit: { sha: sha(3) }, commits: [], files: [] })
      }),
    )
    const { host } = gitHost()

    expect(await host.getMergeBase(repo, sha(1), sha(2))).toBe(sha(3))
    expect(await host.getMergeBase(repo, sha(1), sha(2))).toBe(sha(3))
    expect(requests).toEqual([`/repos/acme/shop/compare/${sha(1)}...${sha(2)}?per_page=1`])
  })

  it('answers null, once, when the commits share no history', async () => {
    let calls = 0
    server.use(
      ...installationHandlers(['acme/shop']),
      http.get(compareUrl, () => {
        calls++
        return HttpResponse.json({ message: 'No common ancestor' }, { status: 404 })
      }),
    )
    const { host } = gitHost()

    expect(await host.getMergeBase(repo, sha(1), sha(2))).toBeNull()
    expect(await host.getMergeBase(repo, sha(1), sha(2))).toBeNull()
    expect(calls).toBe(1)
  })

  it('asks again whether two commits share history after a minute', async () => {
    let calls = 0
    server.use(
      ...installationHandlers(['acme/shop']),
      http.get(compareUrl, () => {
        calls++
        return HttpResponse.json({ message: 'Not Found' }, { status: 404 })
      }),
    )
    let clock = 0
    const { host } = gitHost({ now: () => clock })

    expect(await host.getMergeBase(repo, sha(1), sha(2))).toBeNull()
    clock = 59_000
    expect(await host.getMergeBase(repo, sha(1), sha(2))).toBeNull()
    expect(calls).toBe(1)
    clock = 61_000
    expect(await host.getMergeBase(repo, sha(1), sha(2))).toBeNull()
    expect(calls).toBe(2)
  })

  it('needs no request for a commit compared with itself', async () => {
    const { host } = gitHost()
    expect(await host.getMergeBase(repo, sha(1), sha(1))).toBe(sha(1))
  })

  it('reports the rate limit', async () => {
    server.use(
      ...installationHandlers(['acme/shop']),
      http.get(
        compareUrl,
        () => new HttpResponse(null, { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
      ),
    )
    const { host } = gitHost()
    await expect(host.getMergeBase(repo, sha(1), sha(2))).rejects.toBeInstanceOf(
      GitHubRateLimitedError,
    )
  })

  it('forgets the oldest merge bases beyond its cache size', async () => {
    let calls = 0
    server.use(
      ...installationHandlers(['acme/shop']),
      http.get(compareUrl, () => {
        calls++
        return HttpResponse.json({ merge_base_commit: { sha: sha(9) } })
      }),
    )
    const { host } = gitHost({ mergeBaseCacheSize: 1 })

    await host.getMergeBase(repo, sha(1), sha(2))
    await host.getMergeBase(repo, sha(1), sha(3))
    await host.getMergeBase(repo, sha(1), sha(2))
    expect(calls).toBe(3)
  })

  it('gives the whole branch listing a budget of 30 s', async () => {
    server.use(
      ...installationHandlers(['acme/shop']),
      http.get('https://api.github.com/repos/acme/shop/branches', () => HttpResponse.json([])),
    )
    const { host, api } = gitHost()
    const paginate = vi.spyOn(api, 'paginate')
    expect(await host.listBranches(repo)).toEqual({ branches: [], truncated: false })
    const branchCall = paginate.mock.calls.find(([request]) => request.path.includes('/branches'))
    expect(branchCall?.[3]).toEqual({ budgetMs: BRANCH_LIST_BUDGET_MS })
    expect(BRANCH_LIST_BUDGET_MS).toBe(30_000)
  })

  it('says in the log whether the page cap or the time budget truncated the branches', async () => {
    server.use(
      ...installationHandlers(['acme/shop']),
      http.get('https://api.github.com/repos/acme/shop/branches', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page') ?? '1')
        return HttpResponse.json([{ name: `b${page}`, commit: { sha: sha(page) } }], {
          headers: {
            link: `<https://api.github.com/repos/acme/shop/branches?per_page=100&page=${page + 1}>; rel="next"`,
          },
        })
      }),
    )
    const capped = gitHost()
    await capped.host.listBranches(repo)
    expect(capped.details).toEqual([expect.objectContaining({ cause: 'page cap' })])
    let clock = 0
    const slow = gitHost({ now: () => (clock += BRANCH_LIST_BUDGET_MS) })
    await slow.host.listBranches(repo)
    expect(slow.details.at(-1)).toEqual(expect.objectContaining({ cause: 'time budget' }))
  })
})
