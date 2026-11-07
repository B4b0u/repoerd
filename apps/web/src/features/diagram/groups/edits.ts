import type { TableGroupsResponse } from '@repoerd/contracts'
import {
  adoptOrigins,
  type DbSchema,
  GROUP_PALETTE,
  type GroupOrigin,
  originKey,
  type TableGroup,
  withoutGroup,
} from '@repoerd/model'

/** One write of the group routes; a gesture is a list of them, sent in order. */
export type GroupEdit =
  | { kind: 'saveAll'; groups: TableGroup[]; assignments: Record<string, string | null> }
  | { kind: 'saveGroup'; group: TableGroup }
  | { kind: 'deleteGroup'; groupId: string }
  | { kind: 'place'; assignments: Record<string, string | null>; clear: string[] }

const isFile = (origin: GroupOrigin): origin is { kind: 'file'; path: string } =>
  origin.kind === 'file'

/**
 * The requests of a placement gesture from the current saved state. `target`: a group id, null
 * (explicitly out of any group) or 'origin' (back to following its file). A group that now holds
 * every table of a file the gesture touched adopts that file: only that group is saved, the
 * server takes the file from its previous owner.
 */
export function placeEdits(
  schema: DbSchema,
  current: TableGroupsResponse,
  tables: string[],
  target: string | null | 'origin',
): GroupEdit[] {
  if (target === 'origin') return [{ kind: 'place', assignments: {}, clear: [...tables] }]
  const place: GroupEdit = {
    kind: 'place',
    assignments: Object.fromEntries(tables.map((t) => [t, target])),
    clear: [],
  }
  const group = current.groups.find((g) => g.id === target)
  if (group === undefined) return [place]
  const placed = applyEdits(current, [place])
  const adopted = adoptOrigins(schema, placed).groups.find((g) => g.id === target)
  const touched = new Set(tables.map((t) => schema.tables[t]?.file))
  const owned = new Set(group.origins.filter(isFile).map((o) => o.path))
  const gained = (adopted?.origins ?? [])
    .filter(isFile)
    .filter((o) => touched.has(o.path) && !owned.has(o.path))
  if (gained.length === 0) return [place]
  return [place, { kind: 'saveGroup', group: { ...group, origins: [...group.origins, ...gained] } }]
}

/** What undoes one edit, from the state before the gesture. */
function inverseOfOne(edit: GroupEdit, before: TableGroupsResponse): GroupEdit[] {
  switch (edit.kind) {
    case 'saveAll':
      return [{ kind: 'saveAll', groups: before.groups, assignments: before.assignments }]
    case 'deleteGroup': {
      const group = before.groups.find((g) => g.id === edit.groupId)
      if (group === undefined) return []
      const placements = Object.fromEntries(
        Object.entries(before.assignments).filter(([, id]) => id === edit.groupId),
      )
      const restore: GroupEdit[] = [{ kind: 'saveGroup', group }]
      if (Object.keys(placements).length > 0)
        restore.push({ kind: 'place', assignments: placements, clear: [] })
      return restore
    }
    case 'saveGroup': {
      const previous = before.groups.find((g) => g.id === edit.group.id)
      const taken = new Set(edit.group.origins.map(originKey))
      // The groups the save took an origin from get theirs back, after the group itself.
      const robbed = before.groups.filter(
        (g) => g.id !== edit.group.id && g.origins.some((o) => taken.has(originKey(o))),
      )
      return [
        previous === undefined
          ? { kind: 'deleteGroup', groupId: edit.group.id }
          : { kind: 'saveGroup', group: previous },
        ...robbed.map((group): GroupEdit => ({ kind: 'saveGroup', group })),
      ]
    }
    case 'place': {
      const assignments: Record<string, string | null> = {}
      const clear: string[] = []
      for (const table of [...Object.keys(edit.assignments), ...edit.clear]) {
        if (Object.hasOwn(before.assignments, table))
          assignments[table] = before.assignments[table] as string | null
        else if (!clear.includes(table)) clear.push(table)
      }
      return Object.keys(assignments).length + clear.length === 0
        ? []
        : [{ kind: 'place', assignments, clear }]
    }
  }
}

/** The edits that bring back `before` wherever the gesture changed it ("Undo"). */
export function inverseOf(edits: readonly GroupEdit[], before: TableGroupsResponse): GroupEdit[] {
  const inverse = [...edits].reverse().flatMap((edit) => inverseOfOne(edit, before))
  const seen = new Set<string>()
  // Every inverse edit restores a part of `before`: a repeated one changes nothing.
  return inverse.filter((edit) => {
    const key = JSON.stringify(edit)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** The state once the server applied the edits: the optimistic value of the cache. */
export function applyEdits(
  state: TableGroupsResponse,
  edits: readonly GroupEdit[],
): TableGroupsResponse {
  let { groups, assignments } = state
  for (const edit of edits) {
    switch (edit.kind) {
      case 'saveAll':
        groups = edit.groups
        assignments = edit.assignments
        break
      case 'saveGroup': {
        // One owner per origin: the saved group takes its origins from the others.
        const taken = new Set(edit.group.origins.map(originKey))
        const others = groups.map((g) =>
          g.id === edit.group.id
            ? edit.group
            : { ...g, origins: g.origins.filter((o) => !taken.has(originKey(o))) },
        )
        groups = groups.some((g) => g.id === edit.group.id) ? others : [...others, edit.group]
        break
      }
      case 'deleteGroup': {
        const rest = withoutGroup({ groups, assignments }, edit.groupId)
        groups = rest.groups
        assignments = rest.assignments
        break
      }
      case 'place': {
        const cleared = new Set(edit.clear)
        assignments = Object.fromEntries(
          [...Object.entries(assignments), ...Object.entries(edit.assignments)].filter(
            ([table]) => !cleared.has(table),
          ),
        )
        break
      }
    }
  }
  return { ...state, configured: true, groups, assignments }
}

/** A new empty group: random id, first palette colour no group uses (else the next in turn). */
export function newGroup(existing: readonly TableGroup[], name: string): TableGroup {
  const used = new Set(existing.map((g) => g.color.toLowerCase()))
  const color =
    GROUP_PALETTE.find((c) => !used.has(c)) ??
    (GROUP_PALETTE[existing.length % GROUP_PALETTE.length] as string)
  return { id: crypto.randomUUID().replaceAll('-', '').slice(0, 32), name, color, origins: [] }
}
