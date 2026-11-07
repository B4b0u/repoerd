import { TABLE_GROUP_LIMITS, type TableGroup, type TableGroupConfig } from '@repoerd/model'
import type { KnownRepo } from '../../domain/repo.js'
import { err, ok, type Result } from '../../domain/result.js'
import {
  type TableGroupsError,
  validatePlacement,
  validateTableGroup,
  validateTableGroupConfig,
} from '../../domain/table-groups.js'
import type { StoredTableGroups, TableGroupRepository } from '../ports/table-groups.js'

type WriteError = 'too-many-groups' | 'unknown-group' | 'too-many-assignments' | 'too-many-sources'

function refusal(error: WriteError): TableGroupsError {
  switch (error) {
    case 'too-many-sources':
      return {
        kind: 'invalid-groups-target',
        problem: error,
        message: `At most ${TABLE_GROUP_LIMITS.sources} configured sources per repository`,
      }
    case 'too-many-groups':
      return {
        kind: 'invalid-groups',
        problem: error,
        message: `At most ${TABLE_GROUP_LIMITS.groups} groups per source`,
      }
    case 'too-many-assignments':
      return {
        kind: 'invalid-groups',
        problem: error,
        message: `At most ${TABLE_GROUP_LIMITS.assignments} placements per source`,
      }
    case 'unknown-group':
      return { kind: 'invalid-groups', problem: error, message: 'Placement to an unknown group' }
  }
}

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
      const written = await deps.groups.replace(repo, sourceId, valid.value, userId)
      if (!written.ok) return err(refusal(written.error))
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
      return saved.ok ? ok(undefined) : err(refusal(saved.error))
    },

    deleteGroup: (repo: KnownRepo, sourceId: string, groupId: string, userId: string) =>
      deps.groups.deleteGroup(repo, sourceId, groupId, userId),

    async place(
      repo: KnownRepo,
      sourceId: string,
      input: Record<string, string | null>,
      clear: string[] | undefined,
      userId: string,
    ): Promise<Result<void, TableGroupsError>> {
      const valid = validatePlacement(input, clear)
      if (!valid.ok) return valid
      const placed = await deps.groups.place(
        repo,
        sourceId,
        valid.value.assignments,
        userId,
        valid.value.clear,
      )
      return placed.ok ? ok(undefined) : err(refusal(placed.error))
    },
  }
}

export type TableGroups = ReturnType<typeof makeTableGroups>
