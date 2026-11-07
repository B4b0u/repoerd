import type { TableGroup, TableGroupConfig } from '@repoerd/model'
import type { KnownRepo } from '../../domain/repo.js'

export interface StoredTableGroups {
  /** false until a first write: "never configured" differs from "configured, empty". */
  configured: boolean
  config: TableGroupConfig
}

type Written<E extends string> = { ok: true } | { ok: false; error: E }

/**
 * Table groups of a (repository, schema source), shared by every branch and every user.
 *
 * Every write that does write something marks a never-configured source as configured (the web
 * client therefore saves the whole proposal set first, then edits). A write that would configure
 * a source not yet stored when the repository already holds TABLE_GROUP_LIMITS.sources configured
 * sources fails with 'too-many-sources', writing nothing.
 */
export interface TableGroupRepository {
  get(repo: KnownRepo, sourceId: string): Promise<StoredTableGroups>
  /** Replaces groups and placements, marks the source configured (an empty config included). */
  replace(
    repo: KnownRepo,
    sourceId: string,
    config: TableGroupConfig,
    userId: string,
  ): Promise<Written<'too-many-sources'>>
  /**
   * Upsert of one group. A new id goes last (so deleting a group, then undoing it by a PUT of the
   * same id, moves it to the end); an existing id keeps its place. A new id on a source that
   * already holds TABLE_GROUP_LIMITS.groups groups fails with 'too-many-groups'. In the same
   * transaction, every origin of the saved group is removed from the other groups of the source
   * (only their `origins` are rewritten, and only when they held one of those origins): one
   * owner per origin.
   */
  saveGroup(
    repo: KnownRepo,
    sourceId: string,
    group: TableGroup,
    userId: string,
  ): Promise<Written<'too-many-groups' | 'too-many-sources'>>
  /**
   * Deletes the group and the placements pointing to it. The source is marked configured only
   * when a group was really deleted: an absent id writes nothing.
   */
  deleteGroup(repo: KnownRepo, sourceId: string, groupId: string, userId: string): Promise<void>
  /**
   * Merges placements (table → group id or null) and deletes the placements of `clear` (those
   * tables follow their origin again; absent tables are ignored), in one transaction. The source
   * is marked configured, unless both are empty (nothing written). Fails with 'unknown-group'
   * when an id is not stored, or with 'too-many-assignments' when the distinct placed tables
   * (stored, minus cleared, plus incoming) would exceed TABLE_GROUP_LIMITS.assignments; nothing
   * is written then. A table in both `assignments` and `clear` is refused by the domain
   * validation; if it reaches a store, `clear` wins.
   */
  place(
    repo: KnownRepo,
    sourceId: string,
    assignments: Record<string, string | null>,
    userId: string,
    clear?: string[],
  ): Promise<Written<'unknown-group' | 'too-many-assignments' | 'too-many-sources'>>
}
