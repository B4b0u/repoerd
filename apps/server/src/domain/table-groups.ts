import {
  type GroupOrigin,
  originKey,
  TABLE_GROUP_LIMITS,
  type TableGroup,
  type TableGroupConfig,
  type TableGroupsProblem,
} from '@repoerd/model'
import { err, ok, type Result } from './result.js'

/** `invalid-groups-target` is the per-repository cap of configured sources (`too-many-sources`). */
export type TableGroupsError = {
  kind: 'invalid-groups' | 'invalid-groups-target'
  message: string
  problem: TableGroupsProblem
}

const GROUP_ID = /^[A-Za-z0-9_-]{1,64}$/
const COLOR = /^#[0-9a-fA-F]{6}$/

const invalid = (message: string, problem: TableGroupsProblem = 'invalid') =>
  err<TableGroupsError>({ kind: 'invalid-groups', message, problem })

export const isValidGroupId = (id: string): boolean => GROUP_ID.test(id)

function validOrigin(origin: GroupOrigin): boolean {
  const text = origin.kind === 'pgSchema' ? origin.name : origin.path
  return text.length > 0 && text.length <= TABLE_GROUP_LIMITS.originText
}

/** Validates one group; the name is trimmed and the colour lower-cased. */
export function validateTableGroup(group: TableGroup): Result<TableGroup, TableGroupsError> {
  if (!GROUP_ID.test(group.id)) return invalid('Invalid group id')
  const name = group.name.trim()
  if (name === '' || name.length > TABLE_GROUP_LIMITS.name)
    return invalid(`A group name has 1 to ${TABLE_GROUP_LIMITS.name} characters`)
  if (!COLOR.test(group.color)) return invalid('A group colour is written #rrggbb')
  if (group.origins.length > TABLE_GROUP_LIMITS.origins)
    return invalid(`At most ${TABLE_GROUP_LIMITS.origins} origins per group`)
  if (!group.origins.every(validOrigin))
    return invalid(`An origin has 1 to ${TABLE_GROUP_LIMITS.originText} characters`)
  return ok({ id: group.id, name, color: group.color.toLowerCase(), origins: group.origins })
}

/** Table name → group id or null: sizes, names and ids only (the groups are not looked up). */
export function validateAssignments(
  assignments: Record<string, string | null>,
): Result<Record<string, string | null>, TableGroupsError> {
  const entries = Object.entries(assignments)
  if (entries.length > TABLE_GROUP_LIMITS.assignments)
    return invalid(
      `At most ${TABLE_GROUP_LIMITS.assignments} placements per source`,
      'too-many-assignments',
    )
  for (const [table, groupId] of entries) {
    if (table === '' || table.length > TABLE_GROUP_LIMITS.tableName)
      return invalid(`A table name has 1 to ${TABLE_GROUP_LIMITS.tableName} characters`)
    if (groupId !== null && !GROUP_ID.test(groupId)) return invalid('Invalid group id')
  }
  return ok(assignments)
}

/** Validates a whole config: groups, unique ids, and placements that point to one of its groups. */
export function validateTableGroupConfig(
  config: TableGroupConfig,
): Result<TableGroupConfig, TableGroupsError> {
  if (config.groups.length > TABLE_GROUP_LIMITS.groups)
    return invalid(`At most ${TABLE_GROUP_LIMITS.groups} groups per source`, 'too-many-groups')
  const groups: TableGroup[] = []
  const ids = new Set<string>()
  const owners = new Map<string, string>()
  for (const raw of config.groups) {
    const group = validateTableGroup(raw)
    if (!group.ok) return group
    if (ids.has(group.value.id)) return invalid(`Duplicate group id "${group.value.id}"`)
    ids.add(group.value.id)
    for (const origin of group.value.origins) {
      const key = originKey(origin)
      if (owners.has(key) && owners.get(key) !== group.value.id)
        return invalid(`The origin "${key}" belongs to two groups`, 'duplicate-origin')
      owners.set(key, group.value.id)
    }
    groups.push(group.value)
  }
  const assignments = validateAssignments(config.assignments)
  if (!assignments.ok) return assignments
  for (const groupId of Object.values(assignments.value)) {
    if (groupId !== null && !ids.has(groupId))
      return invalid(`Placement to the unknown group "${groupId}"`, 'unknown-group')
  }
  return ok({ groups, assignments: assignments.value })
}

/** A PATCH of placements: `assignments` to set, `clear` to delete; a table is in at most one. */
export function validatePlacement(
  assignments: Record<string, string | null>,
  clear: string[] = [],
): Result<{ assignments: Record<string, string | null>; clear: string[] }, TableGroupsError> {
  const valid = validateAssignments(assignments)
  if (!valid.ok) return valid
  if (clear.length > TABLE_GROUP_LIMITS.assignments)
    return invalid(
      `At most ${TABLE_GROUP_LIMITS.assignments} placements per source`,
      'too-many-assignments',
    )
  for (const table of clear) {
    if (table === '' || table.length > TABLE_GROUP_LIMITS.tableName)
      return invalid(`A table name has 1 to ${TABLE_GROUP_LIMITS.tableName} characters`)
    if (Object.hasOwn(valid.value, table))
      return invalid(`The table "${table}" is both placed and cleared`)
  }
  return ok({ assignments: valid.value, clear: [...new Set(clear)] })
}
