import type { RepoRef } from '@repoerd/model'
import type {
  MovedRepo,
  RepoAccessSnapshot,
  RepoDirectory,
} from '../../application/ports/repo-directory.js'
import type { FixtureGitHost } from './fixture-git-host.js'

/** Fake mode: every fixture repository is visible to the fake user, with write access. */
export class FixtureRepoDirectory implements RepoDirectory {
  constructor(private readonly host: FixtureGitHost) {}

  // `fresh` is irrelevant: the fixtures never go stale.
  async forUser(): Promise<RepoAccessSnapshot> {
    const repos = await this.host.listRepositories()
    return {
      accounts: [...new Set(repos.map((repo) => repo.owner))],
      repos: repos.map((repo) => ({ ...repo, canWrite: true })),
    }
  }

  async findMoved(_userId: string, repo: RepoRef): Promise<MovedRepo | null> {
    const id = this.host.idOfFormerName(repo)
    if (id === null) return null
    const current = (await this.host.listRepositories()).find((candidate) => candidate.id === id)
    return current ? { id, owner: current.owner, name: current.name } : null
  }
}
