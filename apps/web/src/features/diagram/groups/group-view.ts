import type { TableGroupsResponse } from '@repoerd/contracts'
import { type DbSchema, proposeGroups, resolveTableGroups, type TableGroup } from '@repoerd/model'

export interface GroupView {
  /** True when nothing is saved for the source: the groups are proposals (dashed frames, banner). */
  proposed: boolean
  groups: TableGroup[]
  /** Every table of the schema → its group id, or null (ungrouped). */
  membership: ReadonlyMap<string, string | null>
  canEdit: boolean
  /** True while the groups have neither been received nor failed to load. */
  loading: boolean
}

export interface GroupViewOptions {
  proposalSchema?: DbSchema
  loading?: boolean
}

/**
 * `response` undefined (loading or failed) → no groups at all; `loading` tells the two apart.
 * `proposalSchema`: the schema the groups are proposed from when nothing is saved, `schema` by
 * default; a comparison passes its compared (after) side, so the union's base-only files propose
 * nothing and the groups keep the colours of that branch shown alone. Membership is always
 * resolved on `schema`.
 */
export function buildGroupView(
  schema: DbSchema,
  response: TableGroupsResponse | undefined,
  { proposalSchema = schema, loading = false }: GroupViewOptions = {},
): GroupView {
  if (response === undefined) {
    return {
      proposed: false,
      groups: [],
      membership: resolveTableGroups(schema, { groups: [], assignments: {} }),
      canEdit: false,
      loading,
    }
  }
  const groups = response.configured ? response.groups : proposeGroups(proposalSchema)
  const assignments = response.configured ? response.assignments : {}
  return {
    proposed: !response.configured && groups.length > 0,
    groups,
    membership: resolveTableGroups(schema, { groups, assignments }),
    canEdit: response.canEdit,
    loading: false,
  }
}
