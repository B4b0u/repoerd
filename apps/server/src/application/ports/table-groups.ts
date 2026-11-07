import type { TableGroup, TableGroupConfig } from '@repoerd/model'
import type { KnownRepo } from '../../domain/repo.js'

export interface StoredTableGroups {
  /** false until a first write: "never configured" differs from "configured, empty". */
  configured: boolean
  config: TableGroupConfig
}

/** Table groups of a (repository, schema source), shared by every branch and every user. */
export interface TableGroupRepository {
  get(repo: KnownRepo, sourceId: string): Promise<StoredTableGroups>
  /** Replaces groups and placements, marks the source configured (an empty config included). */
  replace(
    repo: KnownRepo,
    sourceId: string,
    config: TableGroupConfig,
    userId: string,
  ): Promise<void>
  /** Upsert of one group (new ids go last); marks the source configured. */
  saveGroup(repo: KnownRepo, sourceId: string, group: TableGroup, userId: string): Promise<void>
  /** Deletes the group and the placements pointing to it. */
  deleteGroup(repo: KnownRepo, sourceId: string, groupId: string, userId: string): Promise<void>
  /** Merges placements (table → group id or null); fails with 'unknown-group' when an id is not stored, writing nothing. */
  place(
    repo: KnownRepo,
    sourceId: string,
    assignments: Record<string, string | null>,
    userId: string,
  ): Promise<{ ok: true } | { ok: false; error: 'unknown-group' }>
}
