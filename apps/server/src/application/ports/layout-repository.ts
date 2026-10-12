import type { DisplayMode, TablePosition } from '@repoerd/model'
import type { KnownRepo } from '../../domain/repo.js'

/** One saved layout: a user's arrangement of one schema source in one display mode. */
export interface LayoutScope {
  userId: string
  repo: KnownRepo
  sourceId: string
  mode: DisplayMode
}

export interface LayoutRepository {
  get(scope: LayoutScope): Promise<TablePosition[]>
  /** Inserts or updates the given tables only; other saved tables keep their positions ("Rearrange all" too). */
  upsert(scope: LayoutScope, positions: TablePosition[]): Promise<void>
  /** The scopes (source × mode) where the user saved positions for this repository. */
  listScopes(userId: string, repo: KnownRepo): Promise<Pick<LayoutScope, 'sourceId' | 'mode'>[]>
}
