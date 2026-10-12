import type { RepoRef } from '@repoerd/model'
import { z } from 'zod'
import type {
  AccessibleRepo,
  MovedRepo,
  RepoAccessSnapshot,
  RepoDirectory,
} from '../../application/ports/repo-directory.js'
import { type GitHubApi, GitHubHttpError } from './github-api.js'
import type { GitHostLogger } from './github-git-host.js'

/** Visibility is cached per user (spec §7: 5 minutes). */
const DEFAULT_TTL_MS = 5 * 60_000
/** A list older than this is never served: the user waits for the refresh. */
const MAX_STALE_MS = 60 * 60_000

/** A reload asked by the user (`refresh`) is honoured at most once a minute. */
const FORCED_REFRESH_INTERVAL_MS = 60_000
/** Wait after 1, 2, 3, 4+ failed background refreshes in a row before trying again. */
const REFRESH_BACKOFF_MS = [30_000, 60_000, 120_000, 300_000] as const

/** Where an old repository name leads, per user: kept 5 minutes, at most 1,000 answers. */
const MOVED_TTL_MS = 5 * 60_000
const MOVED_CACHE_SIZE = 1000

const movedRepoSchema = z.object({
  id: z.number(),
  name: z.string(),
  owner: z.object({ login: z.string() }),
})

const installationsSchema = z.object({
  installations: z.array(
    z.object({ id: z.number(), account: z.object({ login: z.string() }).nullable() }),
  ),
})
const repositoriesSchema = z.object({
  repositories: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      owner: z.object({ login: z.string() }),
      default_branch: z.string(),
      private: z.boolean(),
      permissions: z.object({ push: z.boolean().optional() }).optional(),
    }),
  ),
})

interface Deps {
  api: GitHubApi
  accessToken: (userId: string) => Promise<string | null>
  logger: GitHostLogger
  now?: () => Date
  ttlMs?: number
}

export class GitHubRepoDirectory implements RepoDirectory {
  private readonly cache = new Map<string, { fetchedAt: number; snapshot: RepoAccessSnapshot }>()
  private readonly moved = new Map<string, { answer: MovedRepo | null; at: number }>()
  private readonly pendingMoved = new Map<string, Promise<MovedRepo | null>>()
  private readonly failures = new Map<string, { count: number; retryAt: number }>()
  private readonly forcedAt = new Map<string, number>()
  /** Refreshes whose failure is already counted: reads sharing one refresh count it once. */
  private readonly watched = new WeakSet<Promise<unknown>>()

  /** Concurrent loads of one user share one request; cleared when it settles. */
  private readonly pending = new Map<string, Promise<RepoAccessSnapshot | null>>()
  /** Bumped by forgetAll: a load started before it is not cached after it. */
  private generation = 0

  constructor(private readonly deps: Deps) {}

  /** Forgets every user's list: the GitHub App changed, so did the installations they see. */
  forgetAll(): void {
    this.generation++
    this.cache.clear()
    this.pending.clear()
    this.moved.clear()
    this.pendingMoved.clear()
    this.failures.clear()
    this.forcedAt.clear()
  }

  findMoved(userId: string, repo: RepoRef): Promise<MovedRepo | null> {
    const key = `${userId}\n${repo.owner}/${repo.name}`.toLowerCase()
    const known = this.moved.get(key)
    if (known && this.now() - known.at < MOVED_TTL_MS) return Promise.resolve(known.answer)
    // Concurrent lookups of one name share one GitHub request.
    const existing = this.pendingMoved.get(key)
    if (existing) return existing
    const lookup = this.lookUpMoved(userId, repo, key).finally(() => {
      this.pendingMoved.delete(key)
    })
    this.pendingMoved.set(key, lookup)
    return lookup
  }

  private async lookUpMoved(userId: string, repo: RepoRef, key: string): Promise<MovedRepo | null> {
    let answer: MovedRepo | null
    try {
      const token = await this.deps.accessToken(userId)
      if (!token) return null
      // GitHub answers a renamed or transferred repository with a 301 that fetch follows.
      const found = await this.deps.api.jsonOrNull(
        {
          path: `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`,
          token,
        },
        movedRepoSchema,
      )
      answer = found ? { id: found.id, owner: found.owner.login, name: found.name } : null
    } catch (error) {
      this.deps.logger.warn(
        { reason: error instanceof Error ? error.message : String(error) },
        'Could not ask GitHub where a repository name leads',
      )
      return null
    }
    // Re-inserting refreshes the entry's place; only a new key can push the oldest one out.
    this.moved.delete(key)
    if (this.moved.size >= MOVED_CACHE_SIZE) {
      const oldest = this.moved.keys().next().value
      if (oldest !== undefined) this.moved.delete(oldest)
    }
    this.moved.set(key, { answer, at: this.now() })
    return answer
  }

  /**
   * The user's repositories. Past the TTL, the previous list is served at once while it is
   * refreshed (up to MAX_STALE_MS old); without one, the user waits for the load. A `fresh` read
   * always waits for the refresh and fails when it fails, whatever the backoff of the background
   * refreshes. `refresh` (the user's own request) reloads at most once a minute.
   */
  forUser(
    userId: string,
    options?: { fresh?: boolean; refresh?: boolean },
  ): Promise<RepoAccessSnapshot | null> {
    const now = this.now()
    if (options?.refresh && this.mayForce(userId, now)) return this.refresh(userId)
    const cached = this.cache.get(userId)
    if (cached && now - cached.fetchedAt < (this.deps.ttlMs ?? DEFAULT_TTL_MS))
      return Promise.resolve(cached.snapshot)
    const refresh = () => this.refresh(userId)
    if (options?.fresh || !cached || now - cached.fetchedAt >= MAX_STALE_MS) return refresh()
    // GitHub failed the last refreshes: keep serving the previous list until the backoff ends.
    const failure = this.failures.get(userId)
    if (failure && now < failure.retryAt) return Promise.resolve(cached.snapshot)
    // A failed refresh logs, keeps the previous list and waits longer before the next try.
    const background = refresh()
    if (this.watched.has(background)) return Promise.resolve(cached.snapshot)
    this.watched.add(background)
    background.catch((error: unknown) => {
      const count = (this.failures.get(userId)?.count ?? 0) + 1
      const wait = REFRESH_BACKOFF_MS[Math.min(count, REFRESH_BACKOFF_MS.length) - 1] ?? 300_000
      this.failures.set(userId, { count, retryAt: this.now() + wait })
      this.deps.logger.warn(
        {
          userId,
          retryInSeconds: wait / 1000,
          reason: error instanceof Error ? error.message : String(error),
        },
        'Could not refresh the repositories of a user: the previous list is kept',
      )
    })
    return Promise.resolve(cached.snapshot)
  }

  /** At most one reload asked by a user per minute; the clock of each user is pruned. */
  private mayForce(userId: string, now: number): boolean {
    for (const [id, at] of this.forcedAt) {
      if (now - at >= FORCED_REFRESH_INTERVAL_MS) this.forcedAt.delete(id)
    }
    if (this.forcedAt.has(userId)) return false
    this.forcedAt.set(userId, now)
    return true
  }

  private refresh(userId: string): Promise<RepoAccessSnapshot | null> {
    const existing = this.pending.get(userId)
    if (existing) return existing
    const promise = this.read(userId).finally(() => {
      // forgetAll may have dropped it and a newer load taken its place: remove this one only.
      if (this.pending.get(userId) === promise) this.pending.delete(userId)
    })
    this.pending.set(userId, promise)
    return promise
  }

  private async read(userId: string): Promise<RepoAccessSnapshot | null> {
    const generation = this.generation
    const token = await this.deps.accessToken(userId)
    if (!token) {
      this.cache.delete(userId)
      return null
    }
    let snapshot: RepoAccessSnapshot
    try {
      snapshot = await this.load(token)
    } catch (error) {
      // Revoked authorisation: the user signs in again.
      if (error instanceof GitHubHttpError && error.status === 401) {
        this.cache.delete(userId)
        return null
      }
      throw error
    }
    if (generation !== this.generation) return snapshot
    const now = this.now()
    for (const [id, entry] of this.cache) {
      if (now - entry.fetchedAt >= MAX_STALE_MS) this.cache.delete(id)
    }
    this.cache.set(userId, { fetchedAt: now, snapshot })
    this.failures.delete(userId)
    return snapshot
  }

  private async load(token: string): Promise<RepoAccessSnapshot> {
    const installations = await this.deps.api.paginate(
      { path: '/user/installations', token },
      installationsSchema,
      (page) => page.installations,
    )
    if (installations.truncated) {
      this.deps.logger.warn(
        { installations: installations.items.length },
        'GitHub lists more App installations than RepoERD reads: the list is truncated',
      )
    }
    // One request chain per installation, all at once.
    const pages = await Promise.all(
      installations.items.map((installation) =>
        this.deps.api.paginate(
          { path: `/user/installations/${installation.id}/repositories`, token },
          repositoriesSchema,
          (result) => result.repositories,
        ),
      ),
    )
    const repos = new Map<string, AccessibleRepo>()
    for (const [index, page] of pages.entries()) {
      if (page.truncated) {
        this.deps.logger.warn(
          { installationId: installations.items[index]?.id, repositories: page.items.length },
          'GitHub lists more repositories than RepoERD reads for an installation: the list is truncated',
        )
      }
      for (const repo of page.items) {
        repos.set(String(repo.id), {
          id: repo.id,
          owner: repo.owner.login,
          name: repo.name,
          defaultBranch: repo.default_branch,
          private: repo.private,
          canWrite: repo.permissions?.push ?? false,
        })
      }
    }
    const accounts = installations.items.flatMap((installation) =>
      installation.account ? [installation.account.login] : [],
    )
    return { accounts: [...new Set(accounts)], repos: [...repos.values()] }
  }

  private now(): number {
    return (this.deps.now?.() ?? new Date()).getTime()
  }
}
