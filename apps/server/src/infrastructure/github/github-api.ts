import type { z } from 'zod'
import {
  GitHubRateLimitedError,
  GitHubUnavailableError,
} from '../../application/ports/github-errors.js'

/** Where RepoERD calls GitHub: its REST and GraphQL API, and its web pages (OAuth). */
export interface GitHubOrigins {
  readonly api: string
  readonly web: string
}

export const GITHUB_ORIGINS: GitHubOrigins = Object.freeze({
  api: 'https://api.github.com',
  web: 'https://github.com',
})

/** GitHub itself, or a fake of it on this machine (REPOERD_TEST_GITHUB_URL, tests only). */
export function githubOrigins(testOrigin: string | undefined): GitHubOrigins {
  return testOrigin ? Object.freeze({ api: testOrigin, web: testOrigin }) : GITHUB_ORIGINS
}
/** Safety net against endless `Link: rel="next"` chains: beyond it the list is truncated. */
const MAX_PAGES = 100
/** Timeout of one REST call, body included. */
export const REST_TIMEOUT_MS = 20_000
/** Timeout of one GraphQL batch of blobs, body included. */
export const GRAPHQL_TIMEOUT_MS = 60_000

export class GitHubHttpError extends Error {
  override name = 'GitHubHttpError'

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface GitHubRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  /** A path under the API origin, or an absolute URL of a trusted origin. */
  path: string
  /** Bearer token: App JWT, installation token or user token. */
  token?: string
  body?: unknown
  accept?: string
  /** Default: REST_TIMEOUT_MS. */
  timeoutMs?: number
  /** How errors and logs name the request when its path carries a secret (a manifest code). */
  label?: string
}

/** The items of every page read, and whether GitHub had more (page cap or time budget). */
export interface Page<T> {
  items: T[]
  truncated: boolean
}

/**
 * Minimal GitHub REST client: fetch + zod. Rate limits throw GitHubRateLimitedError; 5xx answers,
 * timeouts and network failures throw GitHubUnavailableError; other failures GitHubHttpError.
 */
export class GitHubApi {
  constructor(
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    /** Clock of the pagination budgets (tests). */
    private readonly now: () => number = Date.now,
    /** Tokens are only ever sent to these origins (pagination links come from responses). */
    readonly origins: GitHubOrigins = GITHUB_ORIGINS,
  ) {}

  async send(request: GitHubRequest): Promise<Response> {
    const absolute = /^https?:\/\//.test(request.path)
    const url = absolute ? request.path : `${this.origins.api}${request.path}`
    // Fixed messages: the URL may carry a query (OAuth code) and must never reach the logs.
    const origin = [this.origins.api, this.origins.web].find((trusted) =>
      url.startsWith(`${trusted}/`),
    )
    if (!origin) throw new Error('Refusing to call a URL outside the trusted GitHub origins')
    // Dot segments (even encoded) would make the URL parser call another endpoint.
    if (new URL(url).pathname !== url.slice(origin.length).split(/[?#]/, 1)[0])
      throw new Error('Refusing to call a GitHub URL whose path changes once normalised')
    const headers: Record<string, string> = {
      accept: request.accept ?? 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'repoerd',
    }
    if (request.token) headers.authorization = `Bearer ${request.token}`
    if (request.body !== undefined) headers['content-type'] = 'application/json'
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: request.method ?? 'GET',
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(request.timeoutMs ?? REST_TIMEOUT_MS),
      })
    } catch (error) {
      throw unavailable(request, error instanceof Error ? error.name : 'failure')
    }
    if (isRateLimited(response)) {
      discard(response)
      throw new GitHubRateLimitedError(retryAfterSeconds(response))
    }
    if (response.status >= 500) {
      discard(response)
      throw unavailable(request, String(response.status))
    }
    return response
  }

  /** The JSON body; a timeout or a cut connection while reading it means GitHub is unavailable. */
  async readJson(request: GitHubRequest, response: Response): Promise<unknown> {
    try {
      return await response.json()
    } catch (error) {
      throw unavailable(request, error instanceof Error ? error.name : 'failure')
    }
  }

  async json<T>(request: GitHubRequest, schema: z.ZodType<T>): Promise<T> {
    const response = await this.send(request)
    if (!response.ok) throw failure(request, response)
    return schema.parse(await this.readJson(request, response))
  }

  async jsonOrNull<T>(request: GitHubRequest, schema: z.ZodType<T>): Promise<T | null> {
    const response = await this.send(request)
    if (response.status === 404) {
      discard(response)
      return null
    }
    if (!response.ok) throw failure(request, response)
    return schema.parse(await this.readJson(request, response))
  }

  /**
   * Reads every page (per_page=100), following `Link: rel="next"`. Past MAX_PAGES pages, or once
   * `budgetMs` has elapsed since the first page was asked, the list is truncated (callers log
   * it); a link back to a page already read is an error.
   */
  async paginate<P, T>(
    request: GitHubRequest,
    schema: z.ZodType<P>,
    items: (page: P) => T[],
    options: { budgetMs?: number } = {},
  ): Promise<Page<T>> {
    const deadline =
      options.budgetMs === undefined ? Number.POSITIVE_INFINITY : this.now() + options.budgetMs
    const all: T[] = []
    const visited = new Set<string>()
    let path: string | null = withPerPage(request.path)
    while (path) {
      if (visited.has(path))
        throw new Error(`GitHub pagination of ${request.path.split('?')[0]} loops`)
      if (visited.size >= MAX_PAGES || (visited.size > 0 && this.now() >= deadline))
        return { items: all, truncated: true }
      visited.add(path)
      const response = await this.send({ ...request, path })
      if (!response.ok) throw failure(request, response)
      all.push(...items(schema.parse(await this.readJson(request, response))))
      path = nextLink(response.headers.get('link'))
    }
    return { items: all, truncated: false }
  }
}

/** Releases the connection of a response we will not read; not awaited, cancelling may never settle on a mocked stream. */
function discard(response: Response): void {
  response.body?.cancel().catch(() => {})
}

/** Never put the query (codes, tokens) in error messages: they end up in the logs. */
function failure(request: GitHubRequest, response: Response): GitHubHttpError {
  discard(response)
  return new GitHubHttpError(
    response.status,
    `GitHub ${requestName(request)} failed with ${response.status}`,
  )
}

/** How errors name a request: never its query (OAuth codes) nor a secret path segment. */
const requestName = (request: GitHubRequest) =>
  `${request.method ?? 'GET'} ${request.label ?? request.path.split('?')[0]}`

function unavailable(request: GitHubRequest, what: string): GitHubUnavailableError {
  return new GitHubUnavailableError(`GitHub ${requestName(request)} failed: ${what}`)
}

function isRateLimited(response: Response): boolean {
  if (response.status === 429) return true
  return (
    response.status === 403 &&
    (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after'))
  )
}

function retryAfterSeconds(response: Response): number | null {
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter)
  const reset = response.headers.get('x-ratelimit-reset')
  if (reset && /^\d+$/.test(reset))
    return Math.max(0, Number(reset) - Math.floor(Date.now() / 1000))
  return null
}

function withPerPage(path: string): string {
  return path.includes('per_page=') ? path : `${path}${path.includes('?') ? '&' : '?'}per_page=100`
}

function nextLink(header: string | null): string | null {
  for (const part of header?.split(',') ?? []) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part)
    if (match?.[1]) return match[1]
  }
  return null
}
