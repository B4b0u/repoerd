import type { RepoDto } from '@repoerd/contracts'

export function filterRepos(repos: RepoDto[], query: string): RepoDto[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return repos
  return repos.filter((repo) => `${repo.owner}/${repo.name}`.toLowerCase().includes(needle))
}

/** Why the list is empty: nothing visible on GitHub yet, or a filter hiding everything. */
export function emptyRepoListKey(total: number, query: string): 'emptyNone' | 'emptyFiltered' {
  return total === 0 && query.trim() === '' ? 'emptyNone' : 'emptyFiltered'
}
