import type { RepoRef, TreeEntry } from '@repoerd/model'
import type { BlobCache } from '../ports/blob-cache.js'
import type { GitHost } from '../ports/git-host.js'

/** Returns the contents of the given tree entries, keyed by path. */
export type BlobReader = (
  repo: RepoRef,
  entries: readonly TreeEntry[],
) => Promise<Map<string, string>>

export function makeBlobReader(deps: { gitHost: GitHost; blobCache: BlobCache }): BlobReader {
  return async (repo, entries) => {
    const shas = [...new Set(entries.map((entry) => entry.sha))]
    const contents = await deps.blobCache.getMany(shas)
    const missing = shas.filter((sha) => !contents.has(sha))

    if (missing.length > 0) {
      const fetched = await deps.gitHost.getBlobs(repo, missing)
      for (const sha of missing) {
        const content = fetched.get(sha)
        if (content === undefined) throw new Error(`Blob ${sha} was not returned by the git host`)
        contents.set(sha, content)
      }
      await deps.blobCache.putMany(fetched)
    }

    const byPath = new Map<string, string>()
    for (const entry of entries) byPath.set(entry.path, contents.get(entry.sha) ?? '')
    return byPath
  }
}
