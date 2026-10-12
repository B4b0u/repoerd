import type { RepoRef } from '@repoerd/model'
import type {
  AccessibleRepo,
  RepoAccessSnapshot,
  RepoDirectory,
} from '../../src/application/ports/repo-directory.js'
import { testRepoId } from './in-memory-git-host.js'

export const accessible = (
  owner: string,
  name: string,
  canWrite = false,
  id = testRepoId(owner, name),
): AccessibleRepo => ({
  id,
  owner,
  name,
  defaultBranch: 'main',
  private: false,
  canWrite,
})

export class InMemoryRepoDirectory implements RepoDirectory {
  /** null = the user's GitHub authorisation is no longer usable. */
  snapshot: RepoAccessSnapshot | null
  /** Per-user answers; users not listed here get `snapshot`. */
  readonly byUser = new Map<string, RepoAccessSnapshot | null>()

  /** Lower-case owner/name asked → the repository GitHub says it leads to (id, canonical name). */
  readonly moved = new Map<string, { id: number; owner: string; name: string }>()

  async findMoved(_userId: string, repo: RepoRef) {
    return this.moved.get(`${repo.owner}/${repo.name}`.toLowerCase()) ?? null
  }

  constructor(repos: AccessibleRepo[], accounts = ['acme']) {
    this.snapshot = { accounts, repos }
  }

  /** Models a cached list: plain reads get this one, `fresh` reads the current answer. */
  readonly staleByUser = new Map<string, RepoAccessSnapshot | null>()

  /** Every read, with its options (tests check what the use cases asked for). */
  readonly reads: { userId: string; options?: { fresh?: boolean; refresh?: boolean } }[] = []

  async forUser(userId: string, options?: { fresh?: boolean; refresh?: boolean }) {
    this.reads.push({ userId, options })
    if (!options?.fresh && this.staleByUser.has(userId)) return this.staleByUser.get(userId) ?? null
    return this.byUser.has(userId) ? (this.byUser.get(userId) ?? null) : this.snapshot
  }
}
