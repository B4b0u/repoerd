import { createHash } from 'node:crypto'
import type { RepoRef, TreeEntry } from '@repoerd/model'
import type { BranchPage, GitHost, RepoSummary } from '../../src/application/ports/git-host.js'

export interface FakeRepoInput {
  owner: string
  name: string
  defaultBranch?: string
  /** branch name → { path → content } */
  branches: Record<string, Record<string, string>>
}

interface FakeRepo {
  summary: RepoSummary
  branches: Map<string, { commitSha: string; tree: TreeEntry[] }>
  blobs: Map<string, string>
}

const sha1 = (value: string) => createHash('sha1').update(value).digest('hex')

/** A stable id per test repository (GitHub's numeric id in real mode). */
export const testRepoId = (owner: string, name: string) =>
  Number.parseInt(sha1(`${owner}/${name}`.toLowerCase()).slice(0, 8), 16)

export class InMemoryGitHost implements GitHost {
  readonly calls = { getTree: 0, getBlobs: [] as string[][], getMergeBase: 0 }
  private readonly repos: FakeRepo[]
  private readonly truncated: boolean
  private readonly mergeBases: Record<string, string | null>

  /**
   * `mergeBases`: '<base branch>...<head branch>' → the branch whose commit is their merge base,
   * or null when they share no history. Undeclared pairs answer the base commit.
   */
  constructor(
    inputs: FakeRepoInput[],
    options: { truncated?: boolean; mergeBases?: Record<string, string | null> } = {},
  ) {
    this.truncated = options.truncated ?? false
    this.mergeBases = options.mergeBases ?? {}
    this.repos = inputs.map((input) => {
      const blobs = new Map<string, string>()
      const branches = new Map<string, { commitSha: string; tree: TreeEntry[] }>()
      for (const [branch, files] of Object.entries(input.branches)) {
        const tree = Object.entries(files)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([path, content]) => {
            const sha = sha1(`blob:${content}`)
            blobs.set(sha, content)
            return { path, sha, size: Buffer.byteLength(content) }
          })
        const commitSha = sha1(`${branch}:${tree.map((e) => `${e.path}:${e.sha}`).join(',')}`)
        branches.set(branch, { commitSha, tree })
      }
      return {
        summary: {
          id: testRepoId(input.owner, input.name),
          owner: input.owner,
          name: input.name,
          defaultBranch: input.defaultBranch ?? 'main',
          private: false,
        },
        branches,
        blobs,
      }
    })
  }

  async getRepository(ref: RepoRef): Promise<RepoSummary | null> {
    return this.find(ref)?.summary ?? null
  }

  async listBranches(ref: RepoRef): Promise<BranchPage> {
    const repo = this.find(ref)
    return {
      branches: repo
        ? [...repo.branches].map(([name, b]) => ({ name, commitSha: b.commitSha }))
        : [],
      truncated: false,
    }
  }

  async resolveBranch(ref: RepoRef, branch: string): Promise<string | null> {
    return this.find(ref)?.branches.get(branch)?.commitSha ?? null
  }

  async getTree(
    ref: RepoRef,
    commitSha: string,
  ): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    this.calls.getTree++
    for (const branch of this.find(ref)?.branches.values() ?? []) {
      if (branch.commitSha === commitSha) {
        return { entries: branch.tree, truncated: this.truncated }
      }
    }
    throw new Error(`Unknown commit ${commitSha}`)
  }

  async getBlobs(ref: RepoRef, blobShas: string[]): Promise<Map<string, string>> {
    this.calls.getBlobs.push([...blobShas])
    const repo = this.find(ref)
    const result = new Map<string, string>()
    for (const sha of blobShas) {
      const content = repo?.blobs.get(sha)
      if (content !== undefined) result.set(sha, content)
    }
    return result
  }

  async getMergeBase(ref: RepoRef, baseSha: string, headSha: string): Promise<string | null> {
    this.calls.getMergeBase++
    const repo = this.find(ref)
    const branchOf = (sha: string) =>
      [...(repo?.branches ?? [])].find(([, branch]) => branch.commitSha === sha)?.[0]
    const key = `${branchOf(baseSha)}...${branchOf(headSha)}`
    if (!Object.hasOwn(this.mergeBases, key)) return baseSha
    const branch = this.mergeBases[key]
    return branch ? (repo?.branches.get(branch)?.commitSha ?? null) : null
  }

  private find(ref: RepoRef): FakeRepo | undefined {
    return this.repos.find(
      (repo) =>
        repo.summary.owner.toLowerCase() === ref.owner.toLowerCase() &&
        repo.summary.name.toLowerCase() === ref.name.toLowerCase(),
    )
  }
}
