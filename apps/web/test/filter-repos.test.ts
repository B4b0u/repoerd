import type { RepoDto } from '@repoerd/contracts'
import { describe, expect, it } from 'vitest'
import { emptyRepoListKey, filterRepos } from '../src/features/repo-picker/filter-repos'

const repo = (owner: string, name: string): RepoDto => ({
  owner,
  name,
  defaultBranch: 'main',
  private: false,
})
const repos = [repo('acme', 'shop-prisma'), repo('acme', 'blog-drizzle'), repo('Globex', 'Billing')]

describe('filterRepos', () => {
  it('returns everything for an empty or blank query', () => {
    expect(filterRepos(repos, '')).toEqual(repos)
    expect(filterRepos(repos, '   ')).toEqual(repos)
  })

  it('matches owner/name case-insensitively', () => {
    expect(filterRepos(repos, 'PRISMA').map((r) => r.name)).toEqual(['shop-prisma'])
    expect(filterRepos(repos, 'globex/bil').map((r) => r.name)).toEqual(['Billing'])
    expect(filterRepos(repos, 'acme/').map((r) => r.name)).toEqual(['shop-prisma', 'blog-drizzle'])
  })
})

describe('emptyRepoListKey', () => {
  it('explains how to get repositories when GitHub returned none', () => {
    expect(emptyRepoListKey(0, '')).toBe('emptyNone')
    expect(emptyRepoListKey(0, '  ')).toBe('emptyNone')
  })

  it('says the filter hides everything otherwise', () => {
    expect(emptyRepoListKey(3, 'nothing')).toBe('emptyFiltered')
    expect(emptyRepoListKey(0, 'nothing')).toBe('emptyFiltered')
  })
})
