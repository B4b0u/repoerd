import type { Relationship, Table } from './schema.js'

const key = (columns: readonly string[]) => [...columns].sort().join('\u0000')

export function isUniqueColumnSet(table: Table, columns: readonly string[]): boolean {
  const target = key(columns)
  const uniqueSets: string[][] = []
  for (const constraint of table.constraints) {
    if (constraint.kind === 'primaryKey' || constraint.kind === 'unique') {
      uniqueSets.push(constraint.columns)
    }
  }
  for (const index of table.indexes) {
    if (index.unique) uniqueSets.push(index.columns)
  }
  if (uniqueSets.some((set) => key(set) === target)) return true

  if (columns.length === 1) {
    const column = table.columns.find((c) => c.name === columns[0])
    // A column of a composite primary key is not unique by itself: the flag only counts when no
    // primary key constraint says which columns the key has.
    const keyDeclared = table.constraints.some((constraint) => constraint.kind === 'primaryKey')
    return Boolean(column && (column.isUnique || (column.isPrimaryKey && !keyDeclared)))
  }
  return false
}

export function deriveRelationships(tables: Record<string, Table>): Relationship[] {
  const relationships: Relationship[] = []
  for (const table of Object.values(tables)) {
    for (const constraint of table.constraints) {
      if (constraint.kind !== 'foreignKey') continue
      // Own keys only: a target named like an Object member ("constructor") is no table.
      if (!Object.hasOwn(tables, constraint.targetTable)) continue
      relationships.push({
        name: constraint.name,
        from: { table: constraint.targetTable, columns: constraint.targetColumns },
        to: { table: table.name, columns: constraint.columns },
        cardinality: isUniqueColumnSet(table, constraint.columns) ? 'ONE_TO_ONE' : 'ONE_TO_MANY',
      })
    }
  }
  return relationships
}
