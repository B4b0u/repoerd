import { TABLE_GROUP_LIMITS, type TableGroup, type TableGroupConfig } from '@repoerd/model'
import type { KnownRepo } from '../../domain/repo.js'
import { err, ok, type Result } from '../../domain/result.js'
import {
  type TableGroupsError,
  validateAssignments,
  validateTableGroup,
  validateTableGroupConfig,
} from '../../domain/table-groups.js'
import type { StoredTableGroups, TableGroupRepository } from '../ports/table-groups.js'

export function makeTableGroups(deps: { groups: TableGroupRepository }) {
  return {
    get: (repo: KnownRepo, sourceId: string): Promise<StoredTableGroups> =>
      deps.groups.get(repo, sourceId),

    async replace(
      repo: KnownRepo,
      sourceId: string,
      input: TableGroupConfig,
      userId: string,
    ): Promise<Result<StoredTableGroups, TableGroupsError>> {
      const valid = validateTableGroupConfig(input)
      if (!valid.ok) return valid
      await deps.groups.replace(repo, sourceId, valid.value, userId)
      return ok({ configured: true, config: valid.value })
    },

    async saveGroup(
      repo: KnownRepo,
      sourceId: string,
      input: TableGroup,
      userId: string,
    ): Promise<Result<void, TableGroupsError>> {
      const valid = validateTableGroup(input)
      if (!valid.ok) return valid
      const saved = await deps.groups.saveGroup(repo, sourceId, valid.value, userId)
      return saved.ok
        ? ok(undefined)
        : err({
            kind: 'invalid-groups',
            message: `At most ${TABLE_GROUP_LIMITS.groups} groups per source`,
          })
    },

    deleteGroup: (repo: KnownRepo, sourceId: string, groupId: string, userId: string) =>
      deps.groups.deleteGroup(repo, sourceId, groupId, userId),

    async place(
      repo: KnownRepo,
      sourceId: string,
      input: Record<string, string | null>,
      userId: string,
    ): Promise<Result<void, TableGroupsError>> {
      const valid = validateAssignments(input)
      if (!valid.ok) return valid
      const placed = await deps.groups.place(repo, sourceId, valid.value, userId)
      return placed.ok
        ? ok(undefined)
        : err({
            kind: 'invalid-groups',
            message:
              placed.error === 'unknown-group'
                ? 'Placement to an unknown group'
                : `At most ${TABLE_GROUP_LIMITS.assignments} placements per source`,
          })
    },
  }
}

export type TableGroups = ReturnType<typeof makeTableGroups>
