import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type { RepoRef, TreeEntry } from '@repoerd/model'
import type { BranchPage, GitHost, RepoSummary } from '../../application/ports/git-host.js'

interface RepoManifest {
  defaultBranch: string
  branches: Record<string, string>
  /** Branch folder → folder of its fork point (a snapshot that is no branch). */
  forkPoints?: Record<string, string>
  /** Earlier owner/name of the repository: they lead here (a renamed repository, fake mode). */
  formerNames?: string[]
}

interface FixtureRepo {
  owner: string
  name: string
  dir: string
  manifest: RepoManifest
}

interface Snapshot {
  commitSha: string
  entries: TreeEntry[]
  blobs: Map<string, string>
}

export function gitBlobSha(content: string): string {
  const body = Buffer.from(content, 'utf8')
  return createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex')
}

/** Fake mode: a stable id per repository, derived from its lower-case owner/name (48 bits). */
export function fixtureRepoId(owner: string, name: string): number {
  const hash = createHash('sha256').update(`${owner}/${name}`.toLowerCase()).digest('hex')
  return Number.parseInt(hash.slice(0, 12), 16)
}

const toSummary = (repo: FixtureRepo): RepoSummary => ({
  id: fixtureRepoId(repo.owner, repo.name),
  owner: repo.owner,
  name: repo.name,
  defaultBranch: repo.manifest.defaultBranch,
  private: false,
})

/**
 * Serves `<root>/<owner>/<repo>` as if it were GitHub (GITHUB_MODE=fake).
 * The disk is re-read on every call so fixture edits show up immediately during development.
 */
export class FixtureGitHost implements GitHost {
  constructor(private readonly root: string) {}

  async listRepositories(): Promise<RepoSummary[]> {
    return this.repos().map(toSummary)
  }

  async getRepository(ref: RepoRef): Promise<RepoSummary | null> {
    const repo = this.find(ref)
    return repo ? toSummary(repo) : null
  }

  async listBranches(ref: RepoRef): Promise<BranchPage> {
    const repo = this.find(ref)
    if (!repo) return { branches: [], truncated: false }
    return {
      branches: Object.entries(repo.manifest.branches).map(([name, folder]) => ({
        name,
        commitSha: this.snapshot(repo, folder).commitSha,
      })),
      truncated: false,
    }
  }

  async resolveBranch(ref: RepoRef, branch: string): Promise<string | null> {
    const repo = this.find(ref)
    const folder =
      repo && Object.hasOwn(repo.manifest.branches, branch)
        ? repo.manifest.branches[branch]
        : undefined
    return repo && folder ? this.snapshot(repo, folder).commitSha : null
  }

  async getTree(
    ref: RepoRef,
    commitSha: string,
  ): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const snapshot = this.snapshotByCommit(ref, commitSha)
    if (!snapshot) throw new Error(`Unknown commit ${commitSha}`)
    return { entries: snapshot.entries, truncated: false }
  }

  async getBlobs(ref: RepoRef, blobShas: string[]): Promise<Map<string, string>> {
    const repo = this.find(ref)
    const result = new Map<string, string>()
    if (!repo) return result
    const wanted = new Set(blobShas)
    for (const folder of this.folders(repo)) {
      for (const [sha, content] of this.snapshot(repo, folder).blobs) {
        if (wanted.has(sha)) result.set(sha, content)
      }
    }
    return result
  }

  async getMergeBase(ref: RepoRef, baseSha: string, headSha: string): Promise<string | null> {
    if (baseSha === headSha) return baseSha
    const repo = this.find(ref)
    if (!repo) return null
    const forkPoints = repo.manifest.forkPoints ?? {}
    const folderOf = (sha: string) =>
      [...this.folders(repo)].find((folder) => this.snapshot(repo, folder).commitSha === sha)
    const forkOf = (folder: string | undefined) =>
      folder !== undefined && Object.hasOwn(forkPoints, folder) ? forkPoints[folder] : undefined
    const fork = forkOf(folderOf(headSha)) ?? forkOf(folderOf(baseSha))
    return fork ? this.snapshot(repo, fork).commitSha : baseSha
  }

  /** Branch folders and fork-point folders: every snapshot whose commit may be asked for. */
  private folders(repo: FixtureRepo): Set<string> {
    return new Set([
      ...Object.values(repo.manifest.branches),
      ...Object.values(repo.manifest.forkPoints ?? {}),
    ])
  }

  /** The id of the fixture repository that declares this former owner/name, or null. */
  idOfFormerName(ref: RepoRef): number | null {
    const wanted = `${ref.owner}/${ref.name}`.toLowerCase()
    const repo = this.repos().find((candidate) =>
      (candidate.manifest.formerNames ?? []).some((former) => former.toLowerCase() === wanted),
    )
    return repo ? fixtureRepoId(repo.owner, repo.name) : null
  }

  private repos(): FixtureRepo[] {
    if (!existsSync(this.root)) return []
    const repos: FixtureRepo[] = []
    for (const owner of readdirSync(this.root)) {
      const ownerDir = path.join(this.root, owner)
      if (!statSync(ownerDir).isDirectory()) continue
      for (const name of readdirSync(ownerDir)) {
        const dir = path.join(ownerDir, name)
        const manifestPath = path.join(dir, 'repo.json')
        if (!existsSync(manifestPath)) continue
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RepoManifest
        repos.push({ owner, name, dir, manifest })
      }
    }
    return repos
  }

  private find(ref: RepoRef): FixtureRepo | undefined {
    return this.repos().find(
      (repo) =>
        repo.owner.toLowerCase() === ref.owner.toLowerCase() &&
        repo.name.toLowerCase() === ref.name.toLowerCase(),
    )
  }

  private snapshot(repo: FixtureRepo, folder: string): Snapshot {
    const dir = path.join(repo.dir, folder)
    const entries: TreeEntry[] = []
    const blobs = new Map<string, string>()
    for (const relative of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
      const full = path.join(dir, relative)
      if (!statSync(full).isFile()) continue
      const content = readFileSync(full, 'utf8')
      const sha = gitBlobSha(content)
      blobs.set(sha, content)
      entries.push({
        path: relative.split(path.sep).join('/'),
        sha,
        size: Buffer.byteLength(content),
      })
    }
    entries.sort((a, b) => a.path.localeCompare(b.path))
    const commitSha = createHash('sha1')
      .update(entries.map((e) => `${e.path}\0${e.sha}`).join('\n'))
      .digest('hex')
    return { commitSha, entries, blobs }
  }

  private snapshotByCommit(ref: RepoRef, commitSha: string): Snapshot | undefined {
    const repo = this.find(ref)
    if (!repo) return undefined
    for (const folder of this.folders(repo)) {
      const snapshot = this.snapshot(repo, folder)
      if (snapshot.commitSha === commitSha) return snapshot
    }
    return undefined
  }
}
