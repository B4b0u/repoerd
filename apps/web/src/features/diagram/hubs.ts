import type { DbSchema, Relationship } from '@repoerd/model'
import { relationshipEdgeId } from './model/to-flow'

export type HubLinksMode = 'none' | 'first' | 'all'

/**
 * Hub detection and reachability for the branch being viewed: drop removed tables
 * and removed relationships from the union schema.
 */
export function hubViewSchema(
  schema: DbSchema,
  isRemovedTable: (name: string) => boolean,
  isRemovedRelationship: (rel: Relationship) => boolean,
): DbSchema {
  return {
    ...schema,
    tables: Object.fromEntries(
      Object.entries(schema.tables).filter(([name]) => !isRemovedTable(name)),
    ),
    relationships: schema.relationships.filter((rel) => !isRemovedRelationship(rel)),
  }
}

/** The table referenced by the most distinct other tables, if that share is above 30%. */
export function detectHub(schema: DbSchema): string | null {
  const tableCount = Object.keys(schema.tables).length
  if (tableCount === 0) return null

  const referencedBy = new Map<string, Set<string>>()
  for (const name of Object.keys(schema.tables)) referencedBy.set(name, new Set())
  for (const relationship of schema.relationships) {
    const parent = relationship.from.table
    const child = relationship.to.table
    if (parent === child) continue
    if (!Object.hasOwn(schema.tables, parent) || !Object.hasOwn(schema.tables, child)) continue
    referencedBy.get(parent)?.add(child)
  }

  let best: string | null = null
  let bestCount = 0
  for (const [table, children] of referencedBy) {
    const count = children.size
    if (count === 0) continue
    if (
      best === null ||
      count > bestCount ||
      (count === bestCount && table.localeCompare(best) < 0)
    ) {
      best = table
      bestCount = count
    }
  }
  return bestCount > 0.3 * tableCount ? best : null
}

/**
 * `undefined` uses auto-detection; an array is the explicit list (unknown names dropped,
 * order kept, duplicates removed); `[]` means no hub.
 */
export function resolveHubs(schema: DbSchema, fromUrl: string[] | undefined): string[] {
  if (fromUrl === undefined) {
    const hub = detectHub(schema)
    return hub ? [hub] : []
  }
  const seen = new Set<string>()
  const hubs: string[] = []
  for (const name of fromUrl) {
    if (seen.has(name) || !Object.hasOwn(schema.tables, name)) continue
    seen.add(name)
    hubs.push(name)
  }
  return hubs
}

function addEdge(edges: Map<string, Set<string>>, from: string, to: string): void {
  let set = edges.get(from)
  if (!set) {
    set = new Set()
    edges.set(from, set)
  }
  set.add(to)
}

function parentsOfGraph(schema: DbSchema): Map<string, string[]> {
  const parentsOf = new Map<string, Set<string>>()
  for (const relationship of schema.relationships) {
    const parent = relationship.from.table
    const child = relationship.to.table
    if (parent === child) continue
    if (!Object.hasOwn(schema.tables, parent) || !Object.hasOwn(schema.tables, child)) continue
    addEdge(parentsOf, child, parent)
  }
  return new Map([...parentsOf].map(([table, set]) => [table, [...set]]))
}

/** Outgoing edges usable when deciding whether to hide `hub`→`skipChild`. */
function usableChildrenOf(
  schema: DbSchema,
  hub: string,
  skipChild: string,
  hiddenHubChildren: ReadonlySet<string>,
): Map<string, string[]> {
  const childrenOf = new Map<string, Set<string>>()
  for (const relationship of schema.relationships) {
    const parent = relationship.from.table
    const child = relationship.to.table
    if (parent === child) continue
    if (!Object.hasOwn(schema.tables, parent) || !Object.hasOwn(schema.tables, child)) continue
    if (parent === hub && (child === skipChild || hiddenHubChildren.has(child))) continue
    addEdge(childrenOf, parent, child)
  }
  return new Map([...childrenOf].map(([table, set]) => [table, [...set]]))
}

function hubChildrenOf(schema: DbSchema, hub: string): string[] {
  const children = new Set<string>()
  for (const relationship of schema.relationships) {
    const parent = relationship.from.table
    const child = relationship.to.table
    if (parent !== hub || child === hub) continue
    if (!Object.hasOwn(schema.tables, child)) continue
    children.add(child)
  }
  return [...children].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** Tables reachable from `start` along parent→child edges, never visiting `skip`. */
function reachableFrom(
  childrenOf: ReadonlyMap<string, readonly string[]>,
  start: string,
  skip: string,
): Set<string> {
  const seen = new Set<string>([skip, start])
  const reached = new Set<string>()
  const queue = start === skip ? [] : [start]
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index] as string
    reached.add(node)
    for (const next of childrenOf.get(node) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return reached
}

function hideRelationship(
  hidden: Set<string>,
  relationship: Relationship,
  isChanged: ((rel: Relationship) => boolean) | undefined,
): void {
  if (isChanged?.(relationship)) return
  relationship.to.columns.forEach((_, columnIndex) => {
    hidden.add(relationshipEdgeId(relationship, columnIndex))
  })
}

function hideHubChild(
  schema: DbSchema,
  hidden: Set<string>,
  hub: string,
  child: string,
  isChanged: ((rel: Relationship) => boolean) | undefined,
): void {
  for (const relationship of schema.relationships) {
    if (relationship.from.table !== hub || relationship.to.table !== child) continue
    hideRelationship(hidden, relationship, isChanged)
  }
}

/**
 * Edge ids (same as `to-flow`) of hub relationships that must not be drawn.
 * Reachability uses the full schema, not the visible-table subset.
 */
export function hiddenHubRelationships(
  schema: DbSchema,
  hubs: readonly string[],
  mode: HubLinksMode,
  isChanged?: (rel: Relationship) => boolean,
): Set<string> {
  const hidden = new Set<string>()
  if (mode === 'all' || hubs.length === 0) return hidden

  if (mode === 'none') {
    for (const hub of hubs) {
      if (!Object.hasOwn(schema.tables, hub)) continue
      for (const relationship of schema.relationships) {
        if (relationship.from.table !== hub || relationship.to.table === hub) continue
        hideRelationship(hidden, relationship, isChanged)
      }
    }
    return hidden
  }

  const parentsOf = parentsOfGraph(schema)
  for (const hub of hubs) {
    if (!Object.hasOwn(schema.tables, hub)) continue
    const hiddenHubChildren = new Set<string>()
    for (const child of hubChildrenOf(schema, hub)) {
      const otherParents = (parentsOf.get(child) ?? []).filter(
        (parent) => parent !== hub && parent !== child,
      )
      if (otherParents.length > 0) {
        const reached = reachableFrom(
          usableChildrenOf(schema, hub, child, hiddenHubChildren),
          hub,
          child,
        )
        if (otherParents.some((parent) => reached.has(parent))) {
          hideHubChild(schema, hidden, hub, child, isChanged)
          const stillUsable = schema.relationships.some(
            (relationship) =>
              relationship.from.table === hub &&
              relationship.to.table === child &&
              isChanged?.(relationship),
          )
          if (!stillUsable) hiddenHubChildren.add(child)
        }
      }
    }
  }
  return hidden
}
