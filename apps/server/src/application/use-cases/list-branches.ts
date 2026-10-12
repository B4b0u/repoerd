import type { RepoRef } from '@repoerd/model'
import { err, ok, type Result } from '../../domain/result.js'
import type { BranchSummary, GitHost } from '../ports/git-host.js'

export interface BranchList {
  defaultBranch: string
  branches: BranchSummary[]
  /** GitHub has more branches than were read (page cap or time budget). */
  truncated: boolean
}

export type ListBranches = (
  repo: RepoRef,
) => Promise<Result<BranchList, { kind: 'repo-not-found' }>>

export function makeListBranches(deps: { gitHost: GitHost }): ListBranches {
  return async (repo) => {
    const summary = await deps.gitHost.getRepository(repo)
    if (!summary) return err({ kind: 'repo-not-found' })

    const { branches, truncated } = await deps.gitHost.listBranches(repo)
    const rank = (branch: BranchSummary) => (branch.name === summary.defaultBranch ? 0 : 1)
    branches.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    return ok({ defaultBranch: summary.defaultBranch, branches, truncated })
  }
}
