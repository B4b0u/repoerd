import type { RepoRef } from '@repoerd/model'

/**
 * A repository resolved through GitHub. Its data (layouts, manual sources, caches) is keyed by
 * `id`: a rename or a transfer keeps it (spec §6.3).
 */
export interface KnownRepo extends RepoRef {
  /** GitHub's numeric repository id (fake mode: derived from the fixture's name). */
  id: number
}

/** Lower-case `owner/name`: name matching, and the key of the rows saved before plan 6d. */
export const fullName = (repo: RepoRef) => `${repo.owner}/${repo.name}`.toLowerCase()
