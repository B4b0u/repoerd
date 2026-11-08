import { describe, expect, it } from 'vitest'
import type { AccessibleRepo } from '../../src/application/ports/repo-directory.js'
import { MAX_FAVORITES } from '../../src/application/ports/repo-picker.js'
import { makeRepoAccess } from '../../src/application/use-cases/repo-access.js'
import { type FormatSource, makeRepoList } from '../../src/application/use-cases/repo-list.js'
import { accessible, InMemoryRepoDirectory } from '../fakes/in-memory-repo-directory.js'
import {
  InMemoryFavorites,
  InMemoryInstanceConfig,
  InMemoryVisits,
} from '../fakes/in-memory-stores.js'

const NOW = new Date('2026-10-10T12:00:00Z')

function world(repos: AccessibleRepo[], formats?: FormatSource) {
  const directory = new InMemoryRepoDirectory(repos)
  const favorites = new InMemoryFavorites()
  const visits = new InMemoryVisits()
  const asked: { priority: string[] }[] = []
  const source: FormatSource = formats ?? {
    async known(_repos, priority) {
      asked.push({ priority: [...priority].sort() })
      return new Map()
    },
  }
  const repoList = makeRepoList({
    repoAccess: makeRepoAccess({ directory, config: new InMemoryInstanceConfig() }),
    favorites,
    visits,
    formats: source,
    now: () => NOW,
  })
  return { repoList, favorites, visits, directory, asked }
}

const alpha = { ...accessible('acme', 'alpha'), ownerAvatarUrl: 'https://avatars.test/acme' }
const beta = accessible('acme', 'beta')

describe('repository list', () => {
  it('marks favourites, dates the visits and carries the owner avatar', async () => {
    const { repoList, favorites, visits } = world([alpha, beta])
    await favorites.add('u', beta, NOW)
    await visits.record('u', alpha, new Date('2026-10-09T08:00:00Z'))
    expect(await repoList.list('u')).toEqual({
      ok: true,
      value: [
        {
          owner: 'acme',
          name: 'alpha',
          defaultBranch: 'main',
          private: false,
          favorite: false,
          lastOpenedAt: '2026-10-09T08:00:00.000Z',
          ownerAvatarUrl: 'https://avatars.test/acme',
          format: null,
          formatPending: false,
        },
        {
          owner: 'acme',
          name: 'beta',
          defaultBranch: 'main',
          private: false,
          favorite: true,
          lastOpenedAt: null,
          ownerAvatarUrl: null,
          format: null,
          formatPending: false,
        },
      ],
    })
  })

  it('adds the detected formats and their pending state', async () => {
    const format = { kind: 'prisma' as const, checkedAt: NOW.toISOString() }
    const { repoList } = world([alpha, beta], {
      async known() {
        return new Map([
          [String(alpha.id), { format, pending: false }],
          [String(beta.id), { format: null, pending: true }],
        ])
      },
    })
    const result = await repoList.list('u')
    expect(result.ok && result.value.map((r) => [r.format, r.formatPending])).toEqual([
      [format, false],
      [null, true],
    ])
  })

  it('prioritises favourites and the six most recent visits for the format detection', async () => {
    const repos = Array.from({ length: 9 }, (_, i) => accessible('acme', `r${i}`))
    const { repoList, favorites, visits, asked } = world(repos)
    await favorites.add('u', repos[8] as AccessibleRepo, NOW)
    for (const [i, repo] of repos.slice(0, 8).entries())
      await visits.record('u', repo, new Date(NOW.getTime() + i * 1000))
    await repoList.list('u')
    // r7..r2 are the six most recent visits, r8 is the favourite
    const expected = [8, 7, 6, 5, 4, 3, 2]
      .map((i) => String((repos[i] as AccessibleRepo).id))
      .sort()
    expect(asked[0]?.priority).toEqual(expected)
  })

  it('passes the access error through', async () => {
    const { repoList, directory } = world([alpha])
    directory.snapshot = null
    expect(await repoList.list('u')).toEqual({ ok: false, error: { kind: 'reauth-required' } })
  })

  it('stars and unstars a repository', async () => {
    const { repoList, favorites } = world([alpha])
    expect(await repoList.setFavorite('u', alpha, true)).toEqual({ ok: true, value: undefined })
    expect([...(await favorites.list('u'))]).toEqual([String(alpha.id)])
    await repoList.setFavorite('u', alpha, false)
    expect((await favorites.list('u')).size).toBe(0)
  })

  it('refuses a favourite past the limit', async () => {
    const { repoList, favorites } = world([alpha])
    for (let i = 0; i < MAX_FAVORITES; i++) await favorites.add('u', accessible('x', `r${i}`), NOW)
    expect(await repoList.setFavorite('u', alpha, true)).toEqual({
      ok: false,
      error: { kind: 'too-many-favorites', max: 100 },
    })
  })

  it('records a visit at the current time', async () => {
    const { repoList, visits } = world([alpha])
    await repoList.recordVisit('u', alpha)
    expect((await visits.list('u')).get(String(alpha.id))).toEqual(NOW)
  })
})
