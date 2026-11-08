import type { RepoDto } from '@repoerd/contracts'

export interface RepoSections {
  favorites: RepoDto[]
  recents: RepoDto[]
  owners: { owner: string; avatarUrl: string | null; repos: RepoDto[] }[]
  total: number
  /** Repositories listed in `owners`. */
  shown: number
  /** Repositories matching the query that the "with a schema" filter hides. */
  hiddenWithoutSchema: number
  searching: boolean
}

const RECENTS_LIMIT = 6

const fullName = (repo: RepoDto) => `${repo.owner}/${repo.name}`.toLowerCase()
const byName = (a: RepoDto, b: RepoDto) => {
  const left = fullName(a)
  const right = fullName(b)
  return left < right ? -1 : left > right ? 1 : 0
}

/** Splits the repositories into favourites, recent visits and owner groups. */
export function buildRepoSections(
  repos: readonly RepoDto[],
  options: { query: string; schemaOnly: boolean },
): RepoSections {
  const needle = options.query.trim().toLowerCase()
  const searching = needle !== ''
  const matching = repos.filter((repo) => !searching || fullName(repo).includes(needle))
  // Only a detected "none" is hidden: a repository never detected stays visible.
  const hidden = (repo: RepoDto) => options.schemaOnly && repo.format?.kind === 'none'
  const visible = matching.filter((repo) => !hidden(repo))

  const favorites = searching ? [] : visible.filter((repo) => repo.favorite).sort(byName)
  const recents = searching
    ? []
    : visible
        .filter((repo) => repo.lastOpenedAt !== null)
        .sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''))
        .slice(0, RECENTS_LIMIT)

  const groups = new Map<string, { owner: string; avatarUrl: string | null; repos: RepoDto[] }>()
  for (const repo of [...visible].sort(byName)) {
    const key = repo.owner.toLowerCase()
    const group = groups.get(key) ?? { owner: repo.owner, avatarUrl: null, repos: [] }
    group.avatarUrl ??= repo.ownerAvatarUrl
    group.repos.push(repo)
    groups.set(key, group)
  }

  return {
    favorites,
    recents,
    owners: [...groups.values()],
    total: repos.length,
    shown: visible.length,
    hiddenWithoutSchema: matching.length - visible.length,
    searching,
  }
}
