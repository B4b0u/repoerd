import type { Column, DisplayMode, Table } from '@repoerd/model'

/** Above this many tables, schemas open with table names only (D22). */
export const COMPACT_MODE_THRESHOLD = 30

export function defaultDisplayMode(tableCount: number): DisplayMode {
  return tableCount <= COMPACT_MODE_THRESHOLD ? 'ALL_FIELDS' : 'TABLE_NAME'
}

export function foreignKeyColumns(table: Table): string[] {
  return [...new Set(table.constraints.flatMap((c) => (c.kind === 'foreignKey' ? c.columns : [])))]
}

export function visibleColumns(table: Table, mode: DisplayMode): Column[] {
  if (mode === 'TABLE_NAME') return []
  if (mode === 'KEYS_ONLY') {
    const foreignKeys = new Set(foreignKeyColumns(table))
    return table.columns.filter((c) => c.isPrimaryKey || foreignKeys.has(c.name))
  }
  return table.columns
}
