import { type DetectedSource, repoFormatOf } from '@repoerd/model'
import { type KnownRepo, repoKey } from '../../domain/repo.js'
import type { GitHost } from '../ports/git-host.js'
import { GitHubRateLimitedError } from '../ports/github-errors.js'
import type { AccessibleRepo } from '../ports/repo-directory.js'
import type { RepoFormatRepository, StoredRepoFormat } from '../ports/repo-picker.js'
import type { RepoSettingsRepository } from '../ports/repo-settings.js'
import type { FormatSource, ListedRepoFormat } from '../use-cases/repo-list.js'
import type { CommitSchemas } from './commit-schemas.js'

const HOUR_MS = 3600_000
/** A failed check is not retried before this (spec §2.3). */
const RETRY_AFTER_FAILURE_MS = HOUR_MS
/** A repository whose truncated tree shows no schema is not checked again before this. */
const RETRY_AFTER_TRUNCATED_MS = 24 * HOUR_MS
const DEFAULT_CONCURRENCY = 2
const DEFAULT_HOURLY_LIMIT = 200
/** The pause after a rate limit when GitHub does not say how long to wait. */
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60_000

/** Whether a repository's stored format must be detected again (spec §2.3). */
export function needsCheck(
  stored: StoredRepoFormat | undefined,
  failedAt: Date | undefined,
  repo: AccessibleRepo,
  now: Date,
): boolean {
  if (failedAt && now.getTime() - failedAt.getTime() < RETRY_AFTER_FAILURE_MS) return false
  if (!stored || stored.stale) return true
  // An empty repository has no `pushed_at`: once stored, nothing says it changed.
  return repo.pushedAt !== null && Date.parse(repo.pushedAt) > stored.checkedAt.getTime()
}

export interface RepoFormatSyncDeps {
  formats: RepoFormatRepository
  gitHost: GitHost
  settings: RepoSettingsRepository
  /** Shared with the diagram routes (main.ts): a detection already cached costs no GitHub call. */
  commitSchemas: CommitSchemas
  logger: {
    warn(details: object, message: string): void
    info(details: object, message: string): void
  }
  now: () => Date
  /** Checks running at once (default 2). */
  concurrency?: number
  /** Checks started per rolling hour (default 200). */
  hourlyLimit?: number
  /** Runs `run` after `delayMs` (default: an unref'd `setTimeout`). */
  schedule?: (run: () => void, delayMs: number) => void
}

export type RepoFormatSync = FormatSource & {
  /**
   * A detection of the default branch made anyway (a diagram was opened), dated before its branch
   * was read. Never throws.
   */
  record(
    repo: KnownRepo,
    commitSha: string,
    detected: DetectedSource[],
    checkedAt: Date,
  ): Promise<void>
  /** The manual sources changed: the stored format must be detected again. Never throws. */
  markStale(repo: KnownRepo): Promise<void>
  /** Resolves once no check runs (queued ones may wait for the hourly limit). Tests. */
  idle(): Promise<void>
}

const listed = (stored: StoredRepoFormat): ListedRepoFormat => ({
  kind: stored.format,
  checkedAt: stored.checkedAt.toISOString(),
})

const toKnown = (repo: KnownRepo): KnownRepo => ({
  id: repo.id,
  owner: repo.owner,
  name: repo.name,
})

const label = (repo: KnownRepo) => `${repo.owner}/${repo.name}`

/**
 * Keeps each repository's schema format in the database and re-checks, in the background, the
 * ones never detected or outdated (pushed since, manual sources changed). The queue is in memory,
 * per instance, one entry per repository; it only holds repositories some user's list showed.
 */
export function makeRepoFormatSync(deps: RepoFormatSyncDeps): RepoFormatSync {
  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY
  const hourlyLimit = deps.hourlyLimit ?? DEFAULT_HOURLY_LIMIT
  const schedule =
    deps.schedule ?? ((run: () => void, delayMs: number) => setTimeout(run, delayMs).unref())

  // Queued repositories by key, in queue order: the priority ones first.
  const priorityQueue = new Map<string, AccessibleRepo>()
  const queue = new Map<string, AccessibleRepo>()
  const running = new Map<string, Promise<void>>()
  /** Start times (ms) of the checks of the last hour. */
  let starts: number[] = []
  let timerSet = false
  /** GitHub rate-limited a check: none starts before the pause ends. */
  let paused = false
  /** Repositories whose manual sources changed while their check was running. */
  const staleWhileRunning = new Set<string>()
  /** Repositories whose truncated tree showed no schema, by key: when they may be checked again. */
  const truncatedUntil = new Map<string, number>()

  const isQueued = (key: string) => priorityQueue.has(key) || queue.has(key)
  const hasQueued = () => priorityQueue.size > 0 || queue.size > 0

  function enqueue(repo: AccessibleRepo, priority: boolean) {
    const key = repoKey(repo)
    if (running.has(key) || priorityQueue.has(key)) return
    if (priority) {
      queue.delete(key)
      priorityQueue.set(key, repo)
    } else if (!queue.has(key)) {
      queue.set(key, repo)
    }
  }

  function next(): { repo: AccessibleRepo; priority: boolean } | undefined {
    for (const pending of [priorityQueue, queue]) {
      const first = pending.entries().next()
      if (!first.done) {
        const [key, repo] = first.value
        pending.delete(key)
        return { repo, priority: pending === priorityQueue }
      }
    }
    return undefined
  }

  /** Puts a repository whose check could not run back at the head of its queue. */
  function requeueFirst(repo: AccessibleRepo, priority: boolean) {
    const pending = priority ? priorityQueue : queue
    const rest = [...pending]
    pending.clear()
    pending.set(repoKey(repo), repo)
    for (const [key, queued] of rest) pending.set(key, queued)
  }

  /** GitHub refused a check for its rate limit: no check starts before `retryAfterSeconds`. */
  function pause(error: GitHubRateLimitedError) {
    if (paused) return
    paused = true
    deps.logger.warn(
      { retryAfterSeconds: error.retryAfterSeconds },
      'GitHub rate limit reached: the schema format checks pause',
    )
    schedule(
      () => {
        paused = false
        pump()
      },
      error.retryAfterSeconds === null
        ? DEFAULT_RATE_LIMIT_PAUSE_MS
        : error.retryAfterSeconds * 1000,
    )
  }

  function pump() {
    while (!paused && running.size < concurrency && hasQueued()) {
      const nowMs = deps.now().getTime()
      starts = starts.filter((start) => start > nowMs - HOUR_MS)
      if (starts.length >= hourlyLimit) {
        waitForWindow(nowMs)
        return
      }
      const picked = next()
      if (!picked) return
      starts.push(nowMs)
      const key = repoKey(picked.repo)
      running.set(
        key,
        check(picked.repo, picked.priority).finally(() => {
          running.delete(key)
          pump()
        }),
      )
    }
  }

  /** The hourly limit is reached: start again when the oldest start leaves the window. */
  function waitForWindow(nowMs: number) {
    if (timerSet) return
    timerSet = true
    const oldest = starts[0] ?? nowMs
    schedule(
      () => {
        timerSet = false
        pump()
      },
      Math.max(0, oldest + HOUR_MS - nowMs),
    )
  }

  /**
   * The default branch does not resolve. A repository without commits (empty on GitHub) has no
   * branch at all: it has no schema, stored with no commit; its next push re-checks it. A
   * repository the App cannot read, or whose default branch changed since the list, is a failure.
   */
  async function saveWithoutBranch(repo: AccessibleRepo, checkedAt: Date): Promise<void> {
    const current = await deps.gitHost.getRepository(repo)
    if (!current) throw new Error('Repository not found')
    if (current.defaultBranch !== repo.defaultBranch)
      throw new Error(`Default branch ${repo.defaultBranch} not found`)
    await deps.formats.save(toKnown(repo), { format: 'none', commitSha: null, checkedAt })
  }

  /**
   * One repository: never throws, a failure is stored (retried after an hour) and logged. A rate
   * limit is not the repository's failure: it goes back to the head of its queue and the checks
   * pause, rather than spending the rest of the queue on refused requests.
   */
  async function check(repo: AccessibleRepo, priority: boolean): Promise<void> {
    const target = toKnown(repo)
    const key = repoKey(target)
    // The check date is taken before reading the branch: a push during the check stays newer.
    const checkedAt = deps.now()
    try {
      const commitSha = await deps.gitHost.resolveBranch(target, repo.defaultBranch)
      if (!commitSha) {
        await saveWithoutBranch(repo, checkedAt)
        return
      }
      const stored = (await deps.formats.getMany([key])).get(key)
      if (stored && !stored.stale && stored.commitSha === commitSha) {
        // The push touched another branch: the format cannot have changed.
        await deps.formats.touch(target, checkedAt)
        return
      }
      const manual = await deps.settings.get(target)
      const { detected, truncated } = await deps.commitSchemas.detect(target, commitSha, manual)
      const format = repoFormatOf(detected)
      // A truncated listing may hide sources. One found is kept (a second format may be missed);
      // none found is a failure, and the repository is not checked every hour for it.
      if (truncated && format === 'none') {
        truncatedUntil.set(key, deps.now().getTime() + RETRY_AFTER_TRUNCATED_MS)
        deps.logger.info(
          { repo: label(target) },
          'The tree of the default branch is truncated and shows no schema: not checked again for 24 hours',
        )
        await deps.formats.markFailed(target, deps.now())
        return
      }
      await deps.formats.save(target, { format, commitSha, checkedAt })
      truncatedUntil.delete(key)
      if (staleWhileRunning.has(key)) await deps.formats.markStale(target)
    } catch (error) {
      if (error instanceof GitHubRateLimitedError) {
        requeueFirst(repo, priority)
        pause(error)
        return
      }
      deps.logger.warn(
        { err: error, repo: label(target) },
        'Could not detect the schema format of a repository',
      )
      try {
        await deps.formats.markFailed(target, deps.now())
      } catch (markError) {
        deps.logger.warn(
          { err: markError, repo: label(target) },
          'Could not store a failed schema format detection',
        )
      }
    } finally {
      staleWhileRunning.delete(key)
    }
  }

  return {
    async known(repos, priority) {
      const keys = repos.map(repoKey)
      const [stored, failures] = await Promise.all([
        deps.formats.getMany(keys),
        deps.formats.getFailures(keys),
      ])
      const now = deps.now()
      // Priority repositories are queued first, then the list order.
      const ordered = [
        ...repos.filter((repo) => priority.has(repoKey(repo))),
        ...repos.filter((repo) => !priority.has(repoKey(repo))),
      ]
      for (const repo of ordered) {
        const key = repoKey(repo)
        const backedOffUntil = truncatedUntil.get(key)
        if (backedOffUntil !== undefined) {
          if (backedOffUntil > now.getTime()) continue
          truncatedUntil.delete(key)
        }
        if (needsCheck(stored.get(key), failures.get(key), repo, now))
          enqueue(repo, priority.has(key))
      }
      const result = new Map<string, { format: ListedRepoFormat | null; pending: boolean }>()
      for (const key of keys) {
        const format = stored.get(key)
        result.set(key, {
          format: format ? listed(format) : null,
          // A stored format stays shown while it is checked again.
          pending: !format && (isQueued(key) || running.has(key)),
        })
      }
      pump()
      return result
    },

    async record(repo, commitSha, detected, checkedAt) {
      // A detection was made anyway: the back-off no longer applies.
      truncatedUntil.delete(repoKey(repo))
      try {
        await deps.formats.save(toKnown(repo), {
          format: repoFormatOf(detected),
          commitSha,
          checkedAt,
        })
      } catch (error) {
        deps.logger.warn(
          { err: error, repo: label(repo) },
          'Could not store the schema format of a repository',
        )
      }
    },

    async markStale(repo) {
      const key = repoKey(repo)
      // The sources changed: the next check may find what the truncated tree hid.
      truncatedUntil.delete(key)
      if (running.has(key)) staleWhileRunning.add(key)
      try {
        await deps.formats.markStale(toKnown(repo))
      } catch (error) {
        deps.logger.warn(
          { err: error, repo: label(repo) },
          'Could not mark the schema format of a repository to check again',
        )
      }
    },

    async idle() {
      while (running.size > 0) await Promise.all(running.values())
    },
  }
}
