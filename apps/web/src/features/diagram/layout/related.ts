import type { DbSchema, DisplayMode } from '@repoerd/model'
import type { Point } from '../model/dimensions'
import { layoutTables } from './auto-layout'

export function relatedTableNames(schema: DbSchema, table: string): string[] {
  const exists = (name: string) => Object.hasOwn(schema.tables, name)
  if (!exists(table)) return []
  const names = new Set([table])
  for (const relationship of schema.relationships) {
    if (relationship.from.table === table) names.add(relationship.to.table)
    if (relationship.to.table === table) names.add(relationship.from.table)
  }
  return [...names].filter(exists)
}

/** What the detail panel says about a table's neighbours (the table itself is not counted). */
export function relatedSummary(
  schema: DbSchema,
  table: string,
): { count: number; selfReferencing: boolean } {
  return {
    count: Math.max(relatedTableNames(schema, table).length - 1, 0),
    selfReferencing: schema.relationships.some(
      (r) => r.from.table === table && r.to.table === table,
    ),
  }
}

export function subsetSchema(schema: DbSchema, names: readonly string[]): DbSchema {
  const keep = new Set(names)
  return {
    tables: Object.fromEntries(Object.entries(schema.tables).filter(([name]) => keep.has(name))),
    enums: schema.enums,
    relationships: schema.relationships.filter(
      (r) => keep.has(r.from.table) && keep.has(r.to.table),
    ),
  }
}

/** Lays out a table and its direct neighbours on their own (never saved, D12). */
export async function layoutRelated(
  schema: DbSchema,
  table: string,
  mode: DisplayMode,
): Promise<{ schema: DbSchema; positions: Map<string, Point> }> {
  const subset = subsetSchema(schema, relatedTableNames(schema, table))
  return { schema: subset, positions: await layoutTables(subset, Object.keys(subset.tables), mode) }
}
