import type { TableGroupsResponse } from '@repoerd/contracts'
import { type DbSchema, proposeGroups, resolveTableGroups, type TableGroup } from '@repoerd/model'

export interface GroupView {
  /** True when nothing is saved for the source: the groups are proposals (dashed frames, banner). */
  proposed: boolean
  groups: TableGroup[]
  /** Every table of the schema → its group id, or null (ungrouped). */
  membership: ReadonlyMap<string, string | null>
  canEdit: boolean
}

/** `response` undefined (loading or failed) → no groups at all. */
export function buildGroupView(
  schema: DbSchema,
  response: TableGroupsResponse | undefined,
): GroupView {
  if (response === undefined) {
    return {
      proposed: false,
      groups: [],
      membership: resolveTableGroups(schema, { groups: [], assignments: {} }),
      canEdit: false,
    }
  }
  const groups = response.configured ? response.groups : proposeGroups(schema)
  const assignments = response.configured ? response.assignments : {}
  return {
    proposed: !response.configured && groups.length > 0,
    groups,
    membership: resolveTableGroups(schema, { groups, assignments }),
    canEdit: response.canEdit,
  }
}
