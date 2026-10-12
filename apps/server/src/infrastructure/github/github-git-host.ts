import type { RepoRef, TreeEntry } from '@repoerd/model'
import { z } from 'zod'
import type { BranchPage, GitHost, RepoSummary } from '../../application/ports/git-host.js'
import { GitHubRateLimitedError } from '../../application/ports/github-errors.js'
import { type GitHubApi, GitHubHttpError, GRAPHQL_TIMEOUT_MS } from './github-api.js'
import type { InstallationTokens } from './installation-tokens.js'

/** Blobs per GraphQL request (spec §6). */
const BLOB_BATCH = 100
/** Concurrent REST re-reads of truncated blobs. */
const REST_CONCURRENCY = 10
/** The whole branch listing stops starting new pages after 30 s: the list is then truncated. */
export const BRANCH_LIST_BUDGET_MS = 30_000

const repoSchema = z.object({
  id: z.number(),
  name: z.string(),
  owner: z.object({ login: z.string() }),
  default_branch: z.string(),
  private: z.boolean(),
})
const branchesSchema = z.array(
  z.object({ name: z.string(), commit: z.object({ sha: z.string() }) }),
)
const refSchema = z.object({ object: z.object({ sha: z.string(), type: z.string() }) })
const treeSchema = z.object({
  truncated: z.boolean(),
  tree: z.array(
    z.object({ path: z.string(), type: z.string(), sha: z.string(), size: z.number().optional() }),
  ),
})
const restBlobSchema = z.object({ content: z.string(), encoding: z.string() })
const graphqlBlobSchema = z
  .object({
    text: z.string().nullable().optional(),
    isBinary: z.boolean().nullable().optional(),
    isTruncated: z.boolean().optional(),
  })
  .nullable()
const graphqlBlobsSchema = z.object({
  data: z
    .object({ repository: z.record(z.string(), graphqlBlobSchema).nullable() })
    .nullable()
    .optional(),
  errors: z.array(z.object({ type: z.string().optional(), message: z.string() })).optional(),
})

const compareSchema = z.object({ merge_base_commit: z.object({ sha: z.string() }) })
/** Merge bases kept in memory: they never change for a pair of commits. */
const MERGE_BASE_CACHE_SIZE = 1000
/** "No common history" may be a transient 404 (a commit not yet propagated): kept 1 minute. */
const NO_COMMON_HISTORY_TTL_MS = 60_000

export interface GitHostLogger {
  warn(details: object, message: string): void
}

interface Deps {
  api: GitHubApi
  installations: InstallationTokens
  logger: GitHostLogger
  /** Tests only: entries kept in the merge-base cache (default 1000). */
  mergeBaseCacheSize?: number
  /** Tests only: clock of the merge-base cache, in milliseconds (default `Date.now`). */
  now?: () => number
}

const repoPath = (repo: RepoRef) =>
  `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`

const notInstalled = (repo: RepoRef) => (): never => {
  throw new Error(`The GitHub App is not installed on ${repo.owner}/${repo.name}`)
}

/** Repository contents, read with the App's installation token. */
export class GitHubGitHost implements GitHost {
  private readonly mergeBases = new Map<string, { sha: string | null; at: number }>()

  constructor(private readonly deps: Deps) {}

  async getRepository(repo: RepoRef): Promise<RepoSummary | null> {
    const found = await this.withToken(
      repo,
      () => null,
      (token) => this.deps.api.jsonOrNull({ path: repoPath(repo), token }, repoSchema),
    )
    return found
      ? {
          id: found.id,
          owner: found.owner.login,
          name: found.name,
          defaultBranch: found.default_branch,
          private: found.private,
        }
      : null
  }

  async listBranches(repo: RepoRef): Promise<BranchPage> {
    return this.withToken(
      repo,
      () => ({ branches: [], truncated: false }),
      (token) => this.readBranches(repo, token),
    )
  }

  private async readBranches(repo: RepoRef, token: string): Promise<BranchPage> {
    const now = this.deps.now ?? Date.now
    const startedAt = now()
    const branches = await this.deps.api.paginate(
      { path: `${repoPath(repo)}/branches`, token },
      branchesSchema,
      (page) => page,
      { budgetMs: BRANCH_LIST_BUDGET_MS },
    )
    if (branches.truncated) {
      this.deps.logger.warn(
        {
          repo: `${repo.owner}/${repo.name}`,
          branches: branches.items.length,
          cause: now() - startedAt >= BRANCH_LIST_BUDGET_MS ? 'time budget' : 'page cap',
        },
        'GitHub lists more branches than RepoERD reads: the branch list is truncated',
      )
    }
    return {
      branches: branches.items.map((branch) => ({
        name: branch.name,
        commitSha: branch.commit.sha,
      })),
      truncated: branches.truncated,
    }
  }

  async resolveBranch(repo: RepoRef, branch: string): Promise<string | null> {
    // `git/ref` (singular) matches the exact ref only; slashes in branch names stay path separators.
    const path = `${repoPath(repo)}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`
    const ref = await this.withToken(
      repo,
      () => null,
      (token) => this.deps.api.jsonOrNull({ path, token }, refSchema),
    )
    return ref?.object.type === 'commit' ? ref.object.sha : null
  }

  async getTree(
    repo: RepoRef,
    commitSha: string,
  ): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const tree = await this.withToken(repo, notInstalled(repo), (token) =>
      this.deps.api.json(
        {
          path: `${repoPath(repo)}/git/trees/${encodeURIComponent(commitSha)}?recursive=1`,
          token,
        },
        treeSchema,
      ),
    )
    if (tree.truncated) {
      this.deps.logger.warn(
        { repo: `${repo.owner}/${repo.name}`, commitSha },
        'GitHub truncated the repository tree; schemas outside the returned part are not detected',
      )
    }
    const entries = tree.tree
      .filter((entry) => entry.type === 'blob')
      .map((entry) => ({ path: entry.path, sha: entry.sha, size: entry.size ?? 0 }))
    return { entries, truncated: tree.truncated }
  }

  /** Blobs GitHub does not return are absent from the map (the BlobReader reports them). */
  async getBlobs(repo: RepoRef, blobShas: string[]): Promise<Map<string, string>> {
    return this.withToken(repo, notInstalled(repo), (token) =>
      this.readBlobs(repo, token, blobShas),
    )
  }

  private async readBlobs(
    repo: RepoRef,
    token: string,
    blobShas: string[],
  ): Promise<Map<string, string>> {
    const contents = new Map<string, string>()
    for (let start = 0; start < blobShas.length; start += BLOB_BATCH) {
      const batch = blobShas.slice(start, start + BLOB_BATCH)
      const objects = await this.graphqlBlobs(repo, token, batch)
      const rest: string[] = []
      for (const [index, sha] of batch.entries()) {
        const blob = objects[`b${index}`]
        if (!blob) continue
        if (blob.isBinary) contents.set(sha, '')
        else if (blob.isTruncated || typeof blob.text !== 'string') rest.push(sha)
        else contents.set(sha, blob.text)
      }
      // GraphQL truncates large blobs: read those through REST, in parallel.
      for (let from = 0; from < rest.length; from += REST_CONCURRENCY) {
        const chunk = rest.slice(from, from + REST_CONCURRENCY)
        const full = await Promise.all(chunk.map((sha) => this.restBlob(repo, token, sha)))
        for (const [index, sha] of chunk.entries()) contents.set(sha, full[index] ?? '')
      }
    }
    return contents
  }

  async getMergeBase(repo: RepoRef, baseSha: string, headSha: string): Promise<string | null> {
    if (baseSha === headSha) return baseSha
    const key = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}:${baseSha}...${headSha}`
    const now = this.deps.now ?? Date.now
    const cached = this.mergeBases.get(key)
    if (cached && (cached.sha !== null || now() - cached.at < NO_COMMON_HISTORY_TTL_MS))
      return cached.sha
    // GitHub answers 404 when the two commits share no history.
    const path = `${repoPath(repo)}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}?per_page=1`
    const comparison = await this.withToken(repo, notInstalled(repo), (token) =>
      this.deps.api.jsonOrNull({ path, token }, compareSchema),
    )
    const mergeBase = comparison?.merge_base_commit.sha ?? null
    this.mergeBases.delete(key)
    this.mergeBases.set(key, { sha: mergeBase, at: now() })
    const limit = this.deps.mergeBaseCacheSize ?? MERGE_BASE_CACHE_SIZE
    for (const oldest of this.mergeBases.keys()) {
      if (this.mergeBases.size <= limit) break
      this.mergeBases.delete(oldest)
    }
    return mergeBase
  }

  /**
   * Runs `call` with the installation token of the repository; `whenNotInstalled` answers when the
   * App is not installed there. A 401 (App uninstalled, token revoked) forgets the token and the
   * installation, then retries once with fresh ones.
   */
  private async withToken<T>(
    repo: RepoRef,
    whenNotInstalled: () => T,
    call: (token: string) => Promise<T>,
  ): Promise<T> {
    const token = await this.deps.installations.tokenFor(repo)
    if (!token) return whenNotInstalled()
    try {
      return await call(token)
    } catch (error) {
      if (!(error instanceof GitHubHttpError && error.status === 401)) throw error
    }
    this.deps.installations.forget(repo)
    const fresh = await this.deps.installations.tokenFor(repo)
    return fresh ? call(fresh) : whenNotInstalled()
  }

  /** One GraphQL request for up to 100 blobs; oids are variables, never interpolated. */
  private async graphqlBlobs(repo: RepoRef, token: string, shas: string[]) {
    const declarations = shas.map((_, i) => `$o${i}: GitObjectID!`).join(', ')
    const fields = shas
      .map((_, i) => `b${i}: object(oid: $o${i}) { ... on Blob { text isBinary isTruncated } }`)
      .join(' ')
    const query = `query($owner: String!, $name: String!, ${declarations}) { repository(owner: $owner, name: $name) { ${fields} } }`
    const variables: Record<string, string> = { owner: repo.owner, name: repo.name }
    for (const [i, sha] of shas.entries()) variables[`o${i}`] = sha

    const body = await this.deps.api.json(
      {
        method: 'POST',
        path: '/graphql',
        token,
        body: { query, variables },
        timeoutMs: GRAPHQL_TIMEOUT_MS,
      },
      graphqlBlobsSchema,
    )
    if (body.errors?.some((error) => error.type === 'RATE_LIMITED'))
      throw new GitHubRateLimitedError(null)
    const objects = body.data?.repository
    if (!objects) {
      throw new Error(
        `GitHub GraphQL blob query failed: ${body.errors?.map((e) => e.message).join('; ') ?? 'no data'}`,
      )
    }
    return objects
  }

  private async restBlob(repo: RepoRef, token: string, sha: string): Promise<string> {
    const blob = await this.deps.api.json(
      { path: `${repoPath(repo)}/git/blobs/${sha}`, token },
      restBlobSchema,
    )
    return blob.encoding === 'base64'
      ? Buffer.from(blob.content, 'base64').toString('utf8')
      : blob.content
  }
}
