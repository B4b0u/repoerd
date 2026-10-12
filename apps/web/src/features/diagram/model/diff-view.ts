import type {
  ColumnField,
  DiffStatus,
  FieldChange,
  ItemDiff,
  SchemaDiff,
  TableDiff,
} from '@repoerd/model'

export type ChangeStatus = Exclude<DiffStatus, 'unchanged'>

export interface ChangeCounts {
  added: number
  modified: number
  removed: number
}

/** What a table card shows of a comparison. */
export interface NodeDiff {
  status: DiffStatus
  /** Column changes, every column counted (also those the display mode hides). */
  counts: ChangeCounts
  /** By column name. */
  columns: Record<string, ItemDiff<ColumnField>>
}

export function countChanges(items: readonly { status: DiffStatus }[]): ChangeCounts {
  const counts: ChangeCounts = { added: 0, modified: 0, removed: 0 }
  for (const item of items) if (item.status !== 'unchanged') counts[item.status]++
  return counts
}

export const nodeDiff = (table: TableDiff): NodeDiff => ({
  status: table.status,
  counts: countChanges(table.columns),
  columns: Object.fromEntries(table.columns.map((column) => [column.name, column])),
})

/** The type change of a column, written in its card row. */
export function typeChange(
  column: ItemDiff<ColumnField>,
): { before: string; after: string } | null {
  const change = column.changes.find((c) => c.field === 'type')
  return change && typeof change.before === 'string' && typeof change.after === 'string'
    ? { before: change.before, after: change.after }
    : null
}

const sql = (value: FieldChange<ColumnField>['before']): string =>
  value === null ? '∅' : String(value)

function changeTitle(change: FieldChange<ColumnField>): string {
  switch (change.field) {
    case 'type':
      return `TYPE ${sql(change.before)} → ${sql(change.after)}`
    case 'notNull':
      return change.after ? 'NULL → NOT NULL' : 'NOT NULL → NULL'
    case 'default':
      return `DEFAULT ${sql(change.before)} → ${sql(change.after)}`
    case 'comment':
      return `COMMENT ${sql(change.before)} → ${sql(change.after)}`
    case 'isPrimaryKey':
      return change.after ? '+ PRIMARY KEY' : '− PRIMARY KEY'
    case 'isUnique':
      return change.after ? '+ UNIQUE' : '− UNIQUE'
  }
}

/** Tooltip lines of a changed column, in SQL words like the rest of the card tooltip. */
export function columnChangeTitle(changes: readonly FieldChange<ColumnField>[]): string[] {
  return changes.map(changeTitle)
}

export type ChangedTable = TableDiff & { status: ChangeStatus }

const ORDER: Record<ChangeStatus, number> = { added: 0, modified: 1, removed: 2 }

/** The Changes tab: added tables, then modified, then removed, each group by name. */
export function changedTables(diff: SchemaDiff): ChangedTable[] {
  return Object.values(diff.tables)
    .filter((table): table is ChangedTable => table.status !== 'unchanged')
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name))
}

export interface TableChangeSummary {
  columns: ChangeCounts
  /** Indexes added, removed or modified. */
  indexes: number
  /** Constraints added, removed or modified. */
  constraints: number
  comment: boolean
}

export function tableChangeSummary(table: TableDiff): TableChangeSummary {
  const changed = (items: readonly { status: DiffStatus }[]) =>
    items.filter((item) => item.status !== 'unchanged').length
  return {
    columns: countChanges(table.columns),
    indexes: changed(table.indexes),
    constraints: changed(table.constraints),
    comment: table.comment !== null,
  }
}

export const unchangedTables = (diff: SchemaDiff): string[] =>
  Object.values(diff.tables)
    .filter((table) => table.status === 'unchanged')
    .map((table) => table.name)

/** The canvas hides the URL's hidden tables, and the unchanged ones when asked to. */
export function canvasHiddenTables(
  hidden: ReadonlySet<string>,
  diff: SchemaDiff | undefined,
  changedOnly: boolean,
): ReadonlySet<string> {
  return diff && changedOnly ? new Set([...hidden, ...unchangedTables(diff)]) : hidden
}

export const minimapColor = (status: DiffStatus | undefined): string =>
  status && status !== 'unchanged' ? `var(--diff-${status})` : 'var(--header-bg)'
