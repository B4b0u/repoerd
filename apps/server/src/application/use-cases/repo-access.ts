import type { RepoRef } from '@repoerd/model'
import { isAllowedByOrgs } from '../../domain/orgs.js'
import { fullName } from '../../domain/repo.js'
import { err, ok, type Result } from '../../domain/result.js'
import type { RepoSummary } from '../ports/git-host.js'
import type { InstanceConfigRepository } from '../ports/instance-config.js'
import type { LegacyRepoKeys } from '../ports/legacy-repo-keys.js'
import type { AccessibleRepo, RepoAccessSnapshot, RepoDirectory } from '../ports/repo-directory.js'

export type AccessError = { kind: 'reauth-required' } | { kind: 'org-not-allowed' }
export type RepoAccessError =
  | AccessError
  | { kind: 'repo-not-found' }
  | { kind: 'forbidden' }
  | { kind: 'repo-moved'; owner: string; name: string }
export type AccessLevel = 'read' | 'write'

/** The id stays internal: the web knows repositories by owner/name only. */
export type ListRepositories = (
  userId: string,
  options?: { refresh?: boolean },
) => Promise<Result<Omit<RepoSummary, 'id'>[], AccessError>>
export type AuthorizeRepo = (
  userId: string,
  repo: RepoRef,
  level: AccessLevel,
) => Promise<Result<AccessibleRepo, RepoAccessError>>

/** The user still has a working GitHub access, through an allowed organisation (admin routes). */
export type CheckUser = (userId: string) => Promise<Result<void, AccessError>>

export interface RepoAccess {
  listRepositories: ListRepositories
  authorizeRepo: AuthorizeRepo
  checkUser: CheckUser
}

export function makeRepoAccess(deps: {
  directory: RepoDirectory
  config: InstanceConfigRepository
  /** Fake mode has no real accounts to match: it turns the organisation restriction off. */
  enforceAllowedOrgs?: boolean
  /** Moves the rows saved under the repository's name to its id (plan 6d); tests may omit it. */
  legacyKeys?: LegacyRepoKeys
}): RepoAccess {
  async function snapshot(
    userId: string,
    options: { fresh?: boolean; refresh?: boolean } = {},
  ): Promise<Result<RepoAccessSnapshot, AccessError>> {
    const found = await deps.directory.forUser(userId, options)
    if (!found) return err({ kind: 'reauth-required' })
    // Checked at each refresh, so leaving an allowed organisation takes effect within minutes.
    const { allowedOrgs } = await deps.config.get()
    if ((deps.enforceAllowedOrgs ?? true) && !isAllowedByOrgs(allowedOrgs, found.accounts))
      return err({ kind: 'org-not-allowed' })
    return ok(found)
  }

  return {
    async listRepositories(userId, options) {
      const access = await snapshot(userId, { refresh: options?.refresh })
      if (!access.ok) return access
      const repos = access.value.repos.map(
        ({ owner, name, defaultBranch, private: isPrivate }) => ({
          owner,
          name,
          defaultBranch,
          private: isPrivate,
        }),
      )
      return ok(repos.sort((a, b) => fullName(a).localeCompare(fullName(b), 'en')))
    },

    async checkUser(userId) {
      const access = await snapshot(userId, { fresh: true })
      return access.ok ? ok(undefined) : access
    },

    async authorizeRepo(userId, repo, level) {
      const access = await snapshot(userId)
      if (!access.ok) return access
      // Invisible and nonexistent repositories are indistinguishable (no existence leak).
      const byName = (repos: AccessibleRepo[]) =>
        repos.find((candidate) => fullName(candidate) === fullName(repo))
      let found = byName(access.value.repos)
      if (!found) {
        // An old name of a repository the user sees (spec 6.3): point to its current name.
        const leadsTo = await deps.directory.findMoved(userId, repo)
        if (!leadsTo) return err({ kind: 'repo-not-found' })
        if (fullName(leadsTo) === fullName(repo)) {
          // GitHub confirms this is the current name, so the list the user sees lacks it. Read it
          // again: past the TTL this waits for the refresh instead of the list served meanwhile;
          // within the TTL it is the cached list again (a new repository shows up at the next refresh).
          const fresh = await snapshot(userId, { fresh: true })
          if (!fresh.ok) return fresh
          found = byName(fresh.value.repos)
          if (!found) return err({ kind: 'repo-not-found' })
        } else {
          const moved = access.value.repos.find((candidate) => candidate.id === leadsTo.id)
          if (!moved) return err({ kind: 'repo-not-found' })
          // The rows saved under the old name follow the repository.
          await deps.legacyKeys?.adopt(fullName(repo), moved.id)
          return err({ kind: 'repo-moved', owner: moved.owner, name: moved.name })
        }
      }
      await deps.legacyKeys?.adopt(fullName(found), found.id)
      if (level === 'write' && !found.canWrite) return err({ kind: 'forbidden' })
      return ok(found)
    },
  }
}
