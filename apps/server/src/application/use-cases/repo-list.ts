import type { RepoSchemaFormat } from '@repoerd/model'
import { type KnownRepo, repoKey } from '../../domain/repo.js'
import { err, ok, type Result } from '../../domain/result.js'
import type { AccessibleRepo } from '../ports/repo-directory.js'
import {
  type FavoriteRepository,
  MAX_FAVORITES,
  type VisitRepository,
} from '../ports/repo-picker.js'
import type { AccessError, RepoAccess } from './repo-access.js'

/** How many of the latest visits are detected first (the picker shows this many "recent" rows). */
const RECENT_PRIORITY = 6

/** A detected format; the HTTP layer sends it as a `RepoFormatDto`. */
export interface ListedRepoFormat {
  kind: RepoSchemaFormat
  /** ISO date of the detection. */
  checkedAt: string
}

/** One row of the repository list; the HTTP layer sends it as a `RepoDto`. */
export interface ListedRepo {
  owner: string
  name: string
  defaultBranch: string
  private: boolean
  favorite: boolean
  lastOpenedAt: string | null
  ownerAvatarUrl: string | null
  format: ListedRepoFormat | null
  formatPending: boolean
}

/** What the background format detection knows, by repository key; it never calls GitHub itself here. */
export interface FormatSource {
  /** `priority`: keys of the repositories to detect first. */
  known(
    repos: readonly AccessibleRepo[],
    priority: ReadonlySet<string>,
  ): Promise<Map<string, { format: ListedRepoFormat | null; pending: boolean }>>
}

export type SetFavoriteError = { kind: 'too-many-favorites'; max: typeof MAX_FAVORITES }

export function makeRepoList(deps: {
  repoAccess: RepoAccess
  favorites: FavoriteRepository
  visits: VisitRepository
  formats: FormatSource
  now: () => Date
  logger: { warn(details: object, message: string): void }
}) {
  /** The formats are a convenience: failing to read them never fails the list. */
  async function knownFormats(
    repos: readonly AccessibleRepo[],
    priority: ReadonlySet<string>,
  ): ReturnType<FormatSource['known']> {
    try {
      return await deps.formats.known(repos, priority)
    } catch (error) {
      deps.logger.warn({ err: error }, 'Could not read the schema formats of the repositories')
      return new Map()
    }
  }

  return {
    async list(
      userId: string,
      options?: { refresh?: boolean },
    ): Promise<Result<ListedRepo[], AccessError>> {
      const listed = await deps.repoAccess.listRepositories(userId, options)
      if (!listed.ok) return listed
      const [favorites, visits] = await Promise.all([
        deps.favorites.list(userId),
        deps.visits.list(userId),
      ])
      const recent = [...visits.entries()]
        .sort(([, a], [, b]) => b.getTime() - a.getTime())
        .slice(0, RECENT_PRIORITY)
        .map(([key]) => key)
      const formats = await knownFormats(listed.value, new Set([...favorites, ...recent]))
      return ok(
        listed.value.map((repo) => {
          const key = repoKey(repo)
          const known = formats.get(key)
          return {
            owner: repo.owner,
            name: repo.name,
            defaultBranch: repo.defaultBranch,
            private: repo.private,
            favorite: favorites.has(key),
            lastOpenedAt: visits.get(key)?.toISOString() ?? null,
            ownerAvatarUrl: repo.ownerAvatarUrl,
            format: known?.format ?? null,
            formatPending: known?.pending ?? false,
          }
        }),
      )
    },

    async setFavorite(
      userId: string,
      repo: KnownRepo,
      on: boolean,
    ): Promise<Result<void, SetFavoriteError>> {
      if (!on) {
        await deps.favorites.remove(userId, repo)
        return ok(undefined)
      }
      const added = await deps.favorites.add(userId, repo, deps.now())
      return added === 'added'
        ? ok(undefined)
        : err({ kind: 'too-many-favorites', max: MAX_FAVORITES })
    },

    async recordVisit(userId: string, repo: KnownRepo): Promise<void> {
      await deps.visits.record(userId, repo, deps.now())
    },
  }
}

export type RepoList = ReturnType<typeof makeRepoList>
