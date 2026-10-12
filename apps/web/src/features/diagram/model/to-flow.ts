import {
  type Column,
  type DbSchema,
  type DiffStatus,
  type DisplayMode,
  type Relationship,
  relationshipStatus,
  type SchemaDiff,
  type Table,
} from '@repoerd/model'
import type { Edge, Node } from '@xyflow/react'
import { type NodeDiff, nodeDiff } from './diff-view'
import { type Point, tableSize } from './dimensions'
import { foreignKeyColumns, visibleColumns } from './display-mode'

export type NodeHighlight = 'none' | 'active' | 'related' | 'dimmed'

export type TableNodeData = {
  table: Table
  /** Columns shown in the current display mode. */
  columns: Column[]
  foreignKeyColumns: string[]
  mode: DisplayMode
  highlight: NodeHighlight
  /** Set in a comparison. */
  diff?: NodeDiff
}
export type TableFlowNode = Node<TableNodeData, 'table'>
export type RelationshipEdgeData = {
  cardinality: Relationship['cardinality']
  /** Set in a comparison: the status of the foreign key the link comes from. */
  status?: DiffStatus
}
export type RelationshipFlowEdge = Edge<RelationshipEdgeData, 'relationship'>

export const handleId = {
  source: (column: string) => `column:${column}:source`,
  target: (column: string) => `column:${column}:target`,
  tableSource: 'table:source',
  tableTarget: 'table:target',
}

/** In a comparison, `schema` is the union of both sides and `diff` says what changed. */
export function buildFlow(
  schema: DbSchema,
  positions: ReadonlyMap<string, Point>,
  mode: DisplayMode = 'ALL_FIELDS',
  diff?: SchemaDiff,
): { nodes: TableFlowNode[]; edges: RelationshipFlowEdge[] } {
  const nodes: TableFlowNode[] = Object.values(schema.tables)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((table) => {
      const size = tableSize(table, mode)
      const tableDiff =
        diff && Object.hasOwn(diff.tables, table.name) ? diff.tables[table.name] : undefined
      return {
        id: table.name,
        type: 'table',
        position: positions.get(table.name) ?? { x: 0, y: 0 },
        width: size.width,
        height: size.height,
        // React Flow's English "node" role description: the card's own text names it.
        domAttributes: { 'aria-roledescription': undefined },
        data: {
          table,
          columns: visibleColumns(table, mode),
          foreignKeyColumns: foreignKeyColumns(table),
          mode,
          highlight: 'none',
          ...(tableDiff ? { diff: nodeDiff(tableDiff) } : {}),
        },
      }
    })

  const shown = new Map(nodes.map((n) => [n.id, new Set(n.data.columns.map((c) => c.name))]))
  const hasColumn = (table: Table, column: string) => table.columns.some((c) => c.name === column)

  const edges: RelationshipFlowEdge[] = []
  for (const relationship of schema.relationships) {
    const child = schema.tables[relationship.to.table]
    const parent = schema.tables[relationship.from.table]
    if (!child || !parent) continue
    relationship.to.columns.forEach((column, index) => {
      const referenced = relationship.from.columns[index]
      if (!referenced || !hasColumn(child, column) || !hasColumn(parent, referenced)) return
      edges.push({
        id: `${child.name}.${relationship.name}:${index}`,
        source: parent.name,
        sourceHandle: shown.get(parent.name)?.has(referenced)
          ? handleId.source(referenced)
          : handleId.tableSource,
        target: child.name,
        targetHandle: shown.get(child.name)?.has(column)
          ? handleId.target(column)
          : handleId.tableTarget,
        type: 'relationship',
        // Relationships are read in the detail panel; the drawn link is decoration.
        domAttributes: { 'aria-hidden': true },
        data: {
          cardinality: relationship.cardinality,
          ...(diff ? { status: relationshipStatus(diff, relationship) } : {}),
        },
      })
    })
  }
  return { nodes, edges }
}
