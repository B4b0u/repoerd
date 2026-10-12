import type { RepoRef } from '@repoerd/model'
import type { RepoSummary } from './git-host.js'

export interface AccessibleRepo extends RepoSummary {
  /** The user may push to the repository (needed to edit its settings, plan 3b). */
  canWrite: boolean
}

export interface RepoAccessSnapshot {
  /** Accounts (users, organisations) of the App installations the user can access. */
  accounts: string[]
  repos: AccessibleRepo[]
}

/** What GitHub says a name leads to: the repository's id and its current (canonical) name. */
export interface MovedRepo extends RepoRef {
  id: number
}

/** Which repositories a user can see through the App (spec §7: installation × user rights). */
export interface RepoDirectory {
  /**
   * null when the user's GitHub authorisation is no longer usable: they must sign in again.
   * `fresh`: never decide on a list older than the TTL (5 minutes): the refresh is awaited, and a
   * transient failure throws instead of falling back to the previous list. `refresh`: the user
   * asked for a reload: the list is read again (at most once a minute, else as usual); a reload
   * that fails answers the error and still uses up the minute.
   */
  forUser(
    userId: string,
    options?: { fresh?: boolean; refresh?: boolean },
  ): Promise<RepoAccessSnapshot | null>

  /**
   * The repository GitHub says a name leads to (renamed or transferred repository), with its
   * current name, else null. The user's own list is not consulted. A GitHub failure, including
   * the lack of a usable token, answers null.
   */
  findMoved(userId: string, repo: RepoRef): Promise<MovedRepo | null>
}
