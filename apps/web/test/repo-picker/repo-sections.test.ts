import type { RepoDto } from '@repoerd/contracts'
import { describe, expect, it } from 'vitest'
import { buildRepoSections } from '../../src/features/repo-picker/repo-sections'

function repo(owner: string, name: string, extra: Partial<RepoDto> = {}): RepoDto {
  return {
    owner,
    name,
    defaultBranch: 'main',
    private: false,
    favorite: false,
    lastOpenedAt: null,
    ownerAvatarUrl: null,
    format: null,
    formatPending: false,
    ...extra,
  }
}

const none = { kind: 'none', checkedAt: '2026-01-01T00:00:00Z' } as const
const prisma = { kind: 'prisma', checkedAt: '2026-01-01T00:00:00Z' } as const
const all = { query: '', schemaOnly: false }

describe('buildRepoSections', () => {
  it('empties favourites and recents while searching', () => {
    const repos = [
      repo('acme', 'shop', { favorite: true, lastOpenedAt: '2026-03-01T00:00:00Z' }),
      repo('acme', 'blog'),
    ]
    const sections = buildRepoSections(repos, { query: 'SHOP', schemaOnly: false })
    expect(sections.searching).toBe(true)
    expect(sections.favorites).toEqual([])
    expect(sections.recents).toEqual([])
    expect(sections.owners.map((group) => group.repos.map((r) => r.name))).toEqual([['shop']])
    expect(sections.shown).toBe(1)
    expect(sections.total).toBe(2)
  })

  it('searches on owner/name', () => {
    const sections = buildRepoSections([repo('acme', 'shop'), repo('zed', 'x')], {
      query: 'zed/x',
      schemaOnly: false,
    })
    expect(sections.owners.map((group) => group.owner)).toEqual(['zed'])
  })

  it('hides repositories without a schema but keeps unknown ones, and counts the hidden', () => {
    const repos = [
      repo('acme', 'a', { format: none }),
      repo('acme', 'b', { format: null }),
      repo('acme', 'c', { format: prisma }),
    ]
    const sections = buildRepoSections(repos, { query: '', schemaOnly: true })
    expect(sections.owners[0]?.repos.map((r) => r.name)).toEqual(['b', 'c'])
    expect(sections.hiddenWithoutSchema).toBe(1)
    expect(buildRepoSections(repos, all).hiddenWithoutSchema).toBe(0)
  })

  it('counts only hidden repositories matching the query', () => {
    const repos = [repo('acme', 'shop', { format: none }), repo('acme', 'blog', { format: none })]
    const sections = buildRepoSections(repos, { query: 'shop', schemaOnly: true })
    expect(sections.shown).toBe(0)
    expect(sections.hiddenWithoutSchema).toBe(1)
  })

  it('applies the filter to favourites and recents too', () => {
    const repos = [
      repo('acme', 'a', { favorite: true, format: none, lastOpenedAt: '2026-03-01T00:00:00Z' }),
      repo('acme', 'b', { favorite: true }),
    ]
    const sections = buildRepoSections(repos, { query: '', schemaOnly: true })
    expect(sections.favorites.map((r) => r.name)).toEqual(['b'])
    expect(sections.recents).toEqual([])
  })

  it('sorts favourites alphabetically', () => {
    const repos = [
      repo('b', 'x', { favorite: true }),
      repo('a', 'z', { favorite: true }),
      repo('a', 'c', { favorite: true }),
    ]
    expect(buildRepoSections(repos, all).favorites.map((r) => `${r.owner}/${r.name}`)).toEqual([
      'a/c',
      'a/z',
      'b/x',
    ])
  })

  it('keeps the 6 most recent visits, favourites included', () => {
    const repos = Array.from({ length: 8 }, (_, i) =>
      repo('acme', `r${i}`, {
        favorite: i === 7,
        lastOpenedAt: `2026-03-0${i + 1}T00:00:00Z`,
      }),
    )
    const sections = buildRepoSections(repos, all)
    expect(sections.recents.map((r) => r.name)).toEqual(['r7', 'r6', 'r5', 'r4', 'r3', 'r2'])
    expect(sections.favorites.map((r) => r.name)).toEqual(['r7'])
  })

  it('groups by owner alphabetically with the avatar', () => {
    const repos = [
      repo('zed', 'b', { ownerAvatarUrl: 'https://a/z.png' }),
      repo('acme', 'z'),
      repo('acme', 'a'),
    ]
    const { owners } = buildRepoSections(repos, all)
    expect(owners.map((group) => group.owner)).toEqual(['acme', 'zed'])
    expect(owners[0]?.repos.map((r) => r.name)).toEqual(['a', 'z'])
    expect(owners[1]?.avatarUrl).toBe('https://a/z.png')
  })
})
