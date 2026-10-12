import type { RepoRef, TreeEntry } from '@repoerd/model'

export interface RepoSummary {
  /** GitHub's numeric repository id: it survives renames and transfers (fake mode: derived from the name). */
  id: number
  owner: string
  name: string
  defaultBranch: string
  private: boolean
}

export interface BranchSummary {
  name: string
  commitSha: string
}

/** The branches read, and whether GitHub had more (page cap or time budget). */
export interface BranchPage {
  branches: BranchSummary[]
  truncated: boolean
}

/** Read access to repository contents (GitHub App installation token, or the fixture-backed fake). Visibility is the RepoDirectory's job. */
export interface GitHost {
  /** Case-insensitive lookup; null when the repository is unknown. */
  getRepository(repo: RepoRef): Promise<RepoSummary | null>
  listBranches(repo: RepoRef): Promise<BranchPage>
  /** Commit SHA the branch points to, or null when the branch does not exist. */
  resolveBranch(repo: RepoRef, branch: string): Promise<string | null>
  /** Every blob of the commit's tree (directories excluded); `truncated` when GitHub cut the listing (> 100,000 entries or 7 MB). */
  getTree(repo: RepoRef, commitSha: string): Promise<{ entries: TreeEntry[]; truncated: boolean }>
  /** Contents keyed by blob SHA; blobs the host does not return are absent from the map (BlobReader reports them). */
  getBlobs(repo: RepoRef, blobShas: string[]): Promise<Map<string, string>>
  /**
   * The best common ancestor of two commits (`git merge-base`), or null when they share no
   * history. A pair of commits always has the same answer: implementations may cache it.
   */
  getMergeBase(repo: RepoRef, baseSha: string, headSha: string): Promise<string | null>
}
