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
  /**
   * Upsert of one group (new ids go last); marks the source configured. A new id on a source
   * that already holds TABLE_GROUP_LIMITS.groups groups fails with 'too-many-groups', writing nothing.
   */
  saveGroup(
    repo: KnownRepo,
    sourceId: string,
    group: TableGroup,
    userId: string,
  ): Promise<{ ok: true } | { ok: false; error: 'too-many-groups' }>
  /**
   * Deletes the group and the placements pointing to it. The source is marked configured only
   * when a group was really deleted: an absent id writes nothing.
   */
  deleteGroup(repo: KnownRepo, sourceId: string, groupId: string, userId: string): Promise<void>
  /**
   * Merges placements (table → group id or null) and marks the source configured, unless there
   * is no placement at all (nothing written). Fails with 'unknown-group' when an id is not
   * stored, or with 'too-many-assignments' when the distinct placed tables (stored and incoming)
   * would exceed TABLE_GROUP_LIMITS.assignments; nothing is written then.
   */
  place(
    repo: KnownRepo,
    sourceId: string,
    assignments: Record<string, string | null>,
    userId: string,
  ): Promise<{ ok: true } | { ok: false; error: 'unknown-group' | 'too-many-assignments' }>
}
