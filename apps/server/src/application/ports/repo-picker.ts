import type { RepoSchemaFormat } from '@repoerd/model'
import type { KnownRepo } from '../../domain/repo.js'

export const MAX_FAVORITES = 100
export const MAX_VISITS = 20

export interface FavoriteRepository {
  /** Repository keys (`repoKey`) the user starred. */
  list(userId: string): Promise<Set<string>>
  /** Adding an existing favourite answers `'added'`; `'limit'` when the user has `MAX_FAVORITES`. */
  add(userId: string, repo: KnownRepo, now: Date): Promise<'added' | 'limit'>
  remove(userId: string, repo: KnownRepo): Promise<void>
}

export interface VisitRepository {
  /** Upserts the visit, then keeps only the `MAX_VISITS` most recent of the user. */
  record(userId: string, repo: KnownRepo, at: Date): Promise<void>
  list(userId: string): Promise<Map<string, Date>>
}

export interface StoredRepoFormat {
  format: RepoSchemaFormat
  /** null for a repository without commits (empty on GitHub): stored as `none`. */
  commitSha: string | null
  checkedAt: Date
  failedAt: Date | null
  stale: boolean
}

export interface RepoFormatRepository {
  /** Only repositories with a detected format. */
  getMany(keys: readonly string[]): Promise<Map<string, StoredRepoFormat>>
  /** Clears `failedAt` and `stale`. */
  save(
    repo: KnownRepo,
    value: { format: RepoSchemaFormat; commitSha: string | null; checkedAt: Date },
  ): Promise<void>
  /** The commit is unchanged: only the check date moves. */
  touch(repo: KnownRepo, checkedAt: Date): Promise<void>
  /** Works for a repository never detected (the row then has no format). */
  markFailed(repo: KnownRepo, at: Date): Promise<void>
  /** `failedAt` of any row that has one. */
  getFailures(keys: readonly string[]): Promise<Map<string, Date>>
  markStale(repo: KnownRepo): Promise<void>
}
