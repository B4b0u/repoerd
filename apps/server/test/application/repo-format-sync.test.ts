import type { DetectedSource, ManualSource, RepoSchemaFormat } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import { GitHubRateLimitedError } from '../../src/application/ports/github-errors.js'
import type { AccessibleRepo } from '../../src/application/ports/repo-directory.js'
import type { StoredRepoFormat } from '../../src/application/ports/repo-picker.js'
import type { CommitSchemas } from '../../src/application/services/commit-schemas.js'
import { makeRepoFormatSync, needsCheck } from '../../src/application/services/repo-format-sync.js'
import { repoKey } from '../../src/domain/repo.js'
import { type FakeRepoInput, InMemoryGitHost } from '../fakes/in-memory-git-host.js'
import { accessible } from '../fakes/in-memory-repo-directory.js'
import { InMemoryRepoFormats, InMemoryRepoSettings } from '../fakes/in-memory-stores.js'

const NOW = new Date('2026-10-10T12:00:00Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE

const at = (iso: string) => new Date(iso)
const stored = (overrides: Partial<StoredRepoFormat> = {}): StoredRepoFormat => ({
  format: 'prisma',
  commitSha: 'abc',
  checkedAt: at('2026-10-10T10:00:00Z'),
  failedAt: null,
  stale: false,
  ...overrides,
})
const pushed = (pushedAt: string | null): AccessibleRepo => ({
  ...accessible('acme', 'shop'),
  pushedAt,
})

describe('needsCheck', () => {
  it('checks a repository never stored', () => {
    expect(needsCheck(undefined, undefined, pushed(null), NOW)).toBe(true)
  })

  it('checks a repository pushed after its last check, not one pushed before', () => {
    expect(needsCheck(stored(), undefined, pushed('2026-10-10T11:00:00Z'), NOW)).toBe(true)
    expect(needsCheck(stored(), undefined, pushed('2026-10-10T09:00:00Z'), NOW)).toBe(false)
  })

  it('never re-checks a stored repository whose last push is unknown', () => {
    expect(needsCheck(stored(), undefined, pushed(null), NOW)).toBe(false)
  })

  it('checks a repository whose manual sources changed', () => {
    expect(needsCheck(stored({ stale: true }), undefined, pushed(null), NOW)).toBe(true)
  })

  it('waits an hour after a failed check', () => {
    const failed = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE)
    expect(needsCheck(undefined, failed(30), pushed(null), NOW)).toBe(false)
    expect(needsCheck(undefined, failed(61), pushed(null), NOW)).toBe(true)
    const outdated = stored({ stale: true })
    expect(needsCheck(outdated, failed(30), pushed(null), NOW)).toBe(false)
    expect(needsCheck(outdated, failed(61), pushed(null), NOW)).toBe(true)
  })
})

const prismaSource: DetectedSource = {
  source: { id: 'prisma', name: 'prisma', format: 'prisma', origin: 'detected' },
  files: [],
  problem: null,
}
const drizzleSource: DetectedSource = {
  source: { id: 'drizzle', name: 'drizzle', format: 'drizzle', origin: 'detected' },
  files: [],
  problem: null,
}
const sourcesFor: Record<RepoSchemaFormat, DetectedSource[]> = {
  prisma: [prismaSource],
  drizzle: [drizzleSource],
  both: [prismaSource, drizzleSource],
  none: [],
}

const input = (name: string): FakeRepoInput => ({
  owner: 'acme',
  name,
  branches: { main: { 'schema.prisma': name } },
})

/** Several async steps, so that concurrent detections really overlap. */
async function ticks(count = 5) {
  for (let i = 0; i < count; i++) await Promise.resolve()
}

function world(
  names: string[],
  options: {
    concurrency?: number
    hourlyLimit?: number
    /** Repositories on the git host (default: every listed one). */
    onHost?: string[]
    /** Repositories on the git host without any branch (empty on GitHub). */
    empty?: string[]
    formats?: Record<string, RepoSchemaFormat>
    truncated?: boolean
  } = {},
) {
  let clock = NOW
  const repos = names.map((name) => accessible('acme', name))
  const gitHost = new InMemoryGitHost(
    (options.onHost ?? names).map((name) =>
      options.empty?.includes(name) ? { ...input(name), branches: {} } : input(name),
    ),
  )
  const formats = new InMemoryRepoFormats()
  const settings = new InMemoryRepoSettings()
  const detections = {
    calls: [] as string[],
    manual: [] as ManualSource[][],
    inFlight: 0,
    maxInFlight: 0,
    failing: new Set<string>(),
  }
  const commitSchemas: CommitSchemas = {
    async detect(repo, _commitSha, manual) {
      detections.calls.push(repo.name)
      detections.manual.push(manual)
      detections.inFlight++
      detections.maxInFlight = Math.max(detections.maxInFlight, detections.inFlight)
      try {
        await ticks()
        if (detections.failing.has(repo.name)) throw new Error('GitHub answered 502')
        const format = options.formats?.[repo.name] ?? 'prisma'
        return { detected: sourcesFor[format], truncated: options.truncated ?? false }
      } finally {
        detections.inFlight--
      }
    },
    outcomeFor: () => {
      throw new Error('not used')
    },
  }
  const timers: { run: () => void; delayMs: number }[] = []
  const warned: { details: object; message: string }[] = []
  const infos: { details: object; message: string }[] = []
  const sync = makeRepoFormatSync({
    formats,
    gitHost,
    settings,
    commitSchemas,
    logger: {
      warn: (details, message) => warned.push({ details, message }),
      info: (details, message) => infos.push({ details, message }),
    },
    now: () => clock,
    concurrency: options.concurrency,
    hourlyLimit: options.hourlyLimit,
    schedule: (run, delayMs) => timers.push({ run, delayMs }),
  })
  const byName = (name: string) => repos.find((repo) => repo.name === name) as AccessibleRepo
  return {
    sync,
    repos,
    byName,
    gitHost,
    formats,
    settings,
    detections,
    timers,
    warned,
    infos,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms)
    },
    /** known() for every listed repository, by name. */
    async known(priority: string[] = []) {
      const result = await sync.known(repos, new Set(priority.map((name) => repoKey(byName(name)))))
      return Object.fromEntries(repos.map((repo) => [repo.name, result.get(repoKey(repo))]))
    },
  }
}

const NAMES = ['a', 'b', 'c', 'd', 'e']

describe('repository format sync', () => {
  it('detects never-stored repositories in the background, two at a time', async () => {
    const w = world(NAMES)
    const first = await w.known()
    expect(Object.values(first)).toEqual(NAMES.map(() => ({ format: null, pending: true })))
    await w.sync.idle()
    expect(w.detections.calls.sort()).toEqual(NAMES)
    expect(w.detections.maxInFlight).toBe(2)
    expect((await w.known()).a).toEqual({
      format: { kind: 'prisma', checkedAt: NOW.toISOString() },
      pending: false,
    })
  })

  it('reports the format each detection found', async () => {
    const w = world(['a', 'b', 'c'], { formats: { a: 'drizzle', b: 'both', c: 'none' } })
    await w.known()
    await w.sync.idle()
    const known = await w.known()
    expect([known.a?.format?.kind, known.b?.format?.kind, known.c?.format?.kind]).toEqual([
      'drizzle',
      'both',
      'none',
    ])
  })

  it('queues a repository once, however often the list is read', async () => {
    const w = world(NAMES)
    await w.known()
    await w.known()
    await w.sync.idle()
    expect(w.detections.calls).toHaveLength(5)
  })

  it('starts at most hourlyLimit checks per rolling hour, the rest later', async () => {
    const w = world(NAMES, { hourlyLimit: 3 })
    await w.known()
    await w.sync.idle()
    expect(w.detections.calls).toHaveLength(3)
    expect(Object.values(await w.known()).filter((known) => known?.pending)).toHaveLength(2)
    await w.sync.idle()
    expect(w.detections.calls).toHaveLength(3)

    expect(w.timers.map((timer) => timer.delayMs)).toEqual([HOUR])
    w.advance(HOUR)
    w.timers[0]?.run()
    await w.sync.idle()
    expect(w.detections.calls).toHaveLength(5)
  })

  it('checks the favourites and recent repositories first', async () => {
    const w = world(NAMES, { concurrency: 1 })
    await w.known(['d'])
    await w.sync.idle()
    expect(w.detections.calls).toEqual(['d', 'a', 'b', 'c', 'e'])
  })

  it('moves a queued repository forward when it becomes a priority', async () => {
    const w = world(NAMES, { concurrency: 1, hourlyLimit: 1 })
    await w.known()
    await w.known(['e'])
    await w.sync.idle()
    w.advance(HOUR)
    w.timers[0]?.run()
    await w.sync.idle()
    expect(w.detections.calls).toEqual(['a', 'e'])
  })

  it('only moves the check date when the default branch has not changed', async () => {
    const w = world(['a'])
    const repo = { ...w.byName('a'), pushedAt: '2026-10-10T11:00:00Z' }
    const sha = (await w.gitHost.resolveBranch(repo, 'main')) as string
    await w.formats.save(repo, {
      format: 'drizzle',
      commitSha: sha,
      checkedAt: at('2026-10-10T10:00:00Z'),
    })
    const known = await w.sync.known([repo], new Set())
    expect(known.get(repoKey(repo))).toEqual({
      format: { kind: 'drizzle', checkedAt: '2026-10-10T10:00:00.000Z' },
      pending: false,
    })
    await w.sync.idle()
    expect(w.detections.calls).toEqual([])
    expect(w.formats.rows.get(repoKey(repo))).toMatchObject({ format: 'drizzle', checkedAt: NOW })
  })

  it('detects again a repository pushed since its check, serving the old format meanwhile', async () => {
    const w = world(['a'])
    const repo = { ...w.byName('a'), pushedAt: '2026-10-10T11:00:00Z' }
    await w.formats.save(repo, {
      format: 'drizzle',
      commitSha: 'old',
      checkedAt: at('2026-10-10T10:00:00Z'),
    })
    expect((await w.sync.known([repo], new Set())).get(repoKey(repo))?.format?.kind).toBe('drizzle')
    await w.sync.idle()
    expect(w.detections.calls).toEqual(['a'])
    expect(w.formats.rows.get(repoKey(repo))).toMatchObject({ format: 'prisma', checkedAt: NOW })
  })

  it('never re-queues a stored repository whose last push is unknown', async () => {
    const w = world(['a'])
    await w.known()
    await w.sync.idle()
    w.advance(3 * HOUR)
    expect((await w.known()).a?.pending).toBe(false)
    await w.sync.idle()
    expect(w.detections.calls).toEqual(['a'])
  })

  it('a failed check is logged and stored, the next repository is still checked', async () => {
    const w = world(['a', 'b'], { concurrency: 1 })
    w.detections.failing.add('a')
    await w.known()
    await w.sync.idle()
    expect(w.detections.calls).toEqual(['a', 'b'])
    expect(w.formats.rows.get(repoKey(w.byName('a')))).toMatchObject({
      format: null,
      failedAt: NOW,
    })
    expect(w.warned).toHaveLength(1)
    const known = await w.known()
    expect(known.a).toEqual({ format: null, pending: false })
    expect(known.b?.format?.kind).toBe('prisma')

    // Not retried before an hour.
    w.advance(59 * MINUTE)
    await w.known()
    await w.sync.idle()
    expect(w.detections.calls).toEqual(['a', 'b'])
    w.advance(2 * MINUTE)
    w.detections.failing.clear()
    await w.known()
    await w.sync.idle()
    expect(w.detections.calls).toEqual(['a', 'b', 'a'])
    expect(w.formats.rows.get(repoKey(w.byName('a')))).toMatchObject({
      format: 'prisma',
      failedAt: null,
    })
  })

  /** GitHub answers every branch read with a rate limit while `limited` is set. */
  function rateLimited(w: ReturnType<typeof world>, retryAfterSeconds: number | null) {
    const reads: string[] = []
    const state = { limited: true }
    const resolveBranch = w.gitHost.resolveBranch.bind(w.gitHost)
    w.gitHost.resolveBranch = async (repo, branch) => {
      reads.push(repo.name)
      if (state.limited) throw new GitHubRateLimitedError(retryAfterSeconds)
      return resolveBranch(repo, branch)
    }
    return { reads, state }
  }

  it('pauses the checks while GitHub rate-limits them, without marking anything failed', async () => {
    const w = world(['a', 'b', 'c'], { concurrency: 1 })
    const github = rateLimited(w, 30)
    await w.known()
    await w.sync.idle()
    // One refused read, then nothing until the pause ends.
    expect(github.reads).toEqual(['a'])
    expect(w.formats.rows.size).toBe(0)
    expect(w.timers.map((timer) => timer.delayMs)).toEqual([30_000])
    expect(await w.known()).toEqual({
      a: { format: null, pending: true },
      b: { format: null, pending: true },
      c: { format: null, pending: true },
    })
    await w.sync.idle()
    expect(github.reads).toEqual(['a'])

    github.state.limited = false
    w.advance(30_000)
    w.timers[0]?.run()
    await w.sync.idle()
    // The refused repository is checked first, then the rest of the queue.
    expect(github.reads).toEqual(['a', 'a', 'b', 'c'])
    expect(w.formats.rows.get(repoKey(w.byName('a')))).toMatchObject({
      format: 'prisma',
      failedAt: null,
    })
  })

  it('pauses a minute when GitHub does not say how long to wait', async () => {
    const w = world(['a'])
    rateLimited(w, null)
    await w.known()
    await w.sync.idle()
    expect(w.timers.map((timer) => timer.delayMs)).toEqual([60_000])
  })

  it('a repository the App can no longer read fails without stopping the queue', async () => {
    const w = world(['gone', 'b'], { concurrency: 1, onHost: ['b'] })
    await w.known()
    await w.sync.idle()
    expect(w.formats.rows.get(repoKey(w.byName('gone')))).toMatchObject({ failedAt: NOW })
    expect(w.detections.calls).toEqual(['b'])
    expect(w.warned).toHaveLength(1)
  })

  it('stores an empty repository as without schema, and never re-checks it', async () => {
    const w = world(['empty', 'b'], { concurrency: 1, empty: ['empty'] })
    await w.known()
    await w.sync.idle()
    expect(w.formats.rows.get(repoKey(w.byName('empty')))).toMatchObject({
      format: 'none',
      commitSha: null,
      checkedAt: NOW,
      failedAt: null,
    })
    expect(w.detections.calls).toEqual(['b'])
    expect(w.warned).toEqual([])
    w.advance(2 * HOUR)
    expect((await w.known()).empty).toEqual({
      format: { kind: 'none', checkedAt: NOW.toISOString() },
      pending: false,
    })
    await w.sync.idle()
    expect(w.detections.calls).toEqual(['b'])
  })

  it('a default branch renamed since the list is a failure, not an empty repository', async () => {
    const w = world(['a'])
    const listed = { ...w.byName('a'), defaultBranch: 'master' }
    await w.sync.known([listed], new Set())
    await w.sync.idle()
    expect(w.formats.rows.get(repoKey(listed))).toMatchObject({ format: null, failedAt: NOW })
    expect(w.warned).toHaveLength(1)
  })

  it('checks an empty repository again once it is pushed to', async () => {
    const w = world(['a'])
    const empty = { ...w.byName('a'), pushedAt: '2026-10-10T13:00:00Z' }
    await w.formats.save(empty, { format: 'none', commitSha: null, checkedAt: NOW })
    w.advance(2 * HOUR)
    await w.sync.known([empty], new Set())
    await w.sync.idle()
    expect(w.detections.calls).toEqual(['a'])
    expect(w.formats.rows.get(repoKey(empty))?.format).toBe('prisma')
  })

  it('stores the format found in a truncated tree', async () => {
    const w = world(['a'], { truncated: true })
    await w.known()
    await w.sync.idle()
    expect(w.formats.rows.get(repoKey(w.byName('a')))).toMatchObject({
      format: 'prisma',
      failedAt: null,
    })
    expect(w.warned).toEqual([])
  })

  describe('a truncated tree where nothing is found', () => {
    it('is failed, logged at info, and kept out of the queue for 24 hours', async () => {
      const w = world(['a'], { truncated: true, formats: { a: 'none' } })
      await w.known()
      await w.sync.idle()
      expect(w.formats.rows.get(repoKey(w.byName('a')))).toMatchObject({
        format: null,
        failedAt: NOW,
      })
      expect(w.warned).toEqual([])
      expect(w.infos).toHaveLength(1)
      expect(w.infos[0]?.details).toMatchObject({ repo: 'acme/a' })

      w.advance(2 * HOUR)
      await w.known()
      await w.sync.idle()
      expect(w.detections.calls).toEqual(['a'])

      w.advance(23 * HOUR)
      await w.known()
      await w.sync.idle()
      expect(w.detections.calls).toEqual(['a', 'a'])
    })
  })

  describe('the back-off of a truncated tree', () => {
    async function backedOff() {
      const w = world(['a'], { truncated: true, formats: { a: 'none' } })
      await w.known()
      await w.sync.idle()
      w.advance(2 * HOUR)
      await w.known()
      await w.sync.idle()
      expect(w.detections.calls).toEqual(['a'])
      return w
    }

    it('ends when the manual sources change', async () => {
      const w = await backedOff()
      await w.sync.markStale(w.byName('a'))
      await w.known()
      await w.sync.idle()
      expect(w.detections.calls).toEqual(['a', 'a'])
    })

    it('ends when a detection is recorded', async () => {
      const w = await backedOff()
      const repo = w.byName('a')
      await w.sync.record(repo, 'sha', [], w.formats.rows.get(repoKey(repo))?.checkedAt ?? NOW)
      w.advance(2 * HOUR)
      await w.formats.markStale(repo)
      await w.known()
      await w.sync.idle()
      expect(w.detections.calls).toEqual(['a', 'a'])
    })

    it('is removed once expired, so a later truncated result sets a fresh one', async () => {
      const w = await backedOff()
      w.advance(23 * HOUR)
      await w.known()
      await w.sync.idle()
      expect(w.detections.calls).toEqual(['a', 'a'])
      w.advance(2 * HOUR)
      await w.known()
      await w.sync.idle()
      expect(w.detections.calls).toEqual(['a', 'a'])
      w.advance(23 * HOUR)
      await w.known()
      await w.sync.idle()
      expect(w.detections.calls).toEqual(['a', 'a', 'a'])
    })
  })

  it('survives a database that fails during a check', async () => {
    const w = world(['a', 'b'], { concurrency: 1 })
    await w.known()
    w.formats.broken = true
    await w.sync.idle()
    // Nothing stored, both checks logged (failure, then the failure to store it), no rejection.
    expect(w.formats.rows.size).toBe(0)
    const repos = w.warned.map(({ details }) => (details as { repo: string }).repo)
    expect(repos).toEqual(['acme/a', 'acme/a', 'acme/b', 'acme/b'])
  })

  it('re-detects a repository whose manual sources changed, with those sources', async () => {
    const w = world(['a'])
    await w.known()
    await w.sync.idle()
    const repo = w.byName('a')
    const manual = [{ name: 'core', format: 'drizzle' as const, paths: ['src/db'] }]
    await w.settings.save(repo, manual, 'alice')
    await w.sync.markStale(repo)
    // The commit is unchanged, yet the sources are not the ones detected.
    expect((await w.known()).a?.format?.kind).toBe('prisma')
    await w.sync.idle()
    expect(w.detections.calls).toEqual(['a', 'a'])
    expect(w.detections.manual[1]).toEqual(manual)
    expect(w.formats.rows.get(repoKey(repo))?.stale).toBe(false)
  })

  it('keeps a repository stale when its sources change during its check', async () => {
    const w = world(['a'])
    await w.known()
    await w.sync.markStale(w.byName('a'))
    await w.sync.idle()
    expect(w.formats.rows.get(repoKey(w.byName('a')))).toMatchObject({
      format: 'prisma',
      stale: true,
    })
  })

  it('records the format a diagram opening detected', async () => {
    const w = world(['a'])
    await w.sync.record(w.byName('a'), 'sha-1', [prismaSource, drizzleSource], NOW)
    expect(w.formats.rows.get(repoKey(w.byName('a')))).toMatchObject({
      format: 'both',
      commitSha: 'sha-1',
      checkedAt: NOW,
    })
    expect((await w.known()).a).toEqual({
      format: { kind: 'both', checkedAt: NOW.toISOString() },
      pending: false,
    })
    await w.sync.idle()
    expect(w.detections.calls).toEqual([])
  })

  it('stores the check date the diagram request took, not the time of the record', async () => {
    const w = world(['a'])
    const requestStart = new Date(NOW.getTime() - 5_000)
    await w.sync.record(w.byName('a'), 'sha-1', [prismaSource], requestStart)
    expect(w.formats.rows.get(repoKey(w.byName('a')))?.checkedAt).toEqual(requestStart)
  })

  it('a record or a mark that cannot be saved is logged, never thrown', async () => {
    const w = world(['a'])
    w.formats.broken = true
    await expect(w.sync.record(w.byName('a'), 'sha-1', [], NOW)).resolves.toBeUndefined()
    await expect(w.sync.markStale(w.byName('a'))).resolves.toBeUndefined()
    expect(w.warned).toHaveLength(2)
  })
})
