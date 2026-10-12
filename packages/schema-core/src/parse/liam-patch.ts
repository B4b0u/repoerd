import type { Column, Schema, Table } from '@liam-hq/schema'

/**
 * What RepoERD's patch of @liam-hq/schema 0.6.1 (`patches/@liam-hq__schema@0.6.1.patch`) adds to
 * the parser's output. Every file the patch modifies starts with `// Modified by RepoERD:`.
 */
export type PatchedLiamColumn = Column & {
  /** Drizzle: the name was written in the column call (`text('first_name')`), not taken from its key. */
  nameExplicit?: boolean
}

export type PatchedLiamTable = Omit<Table, 'columns'> & {
  columns: Record<string, PatchedLiamColumn>
  /**
   * The Postgres schema declared by `pgSchema('x').table()` or `@@schema("x")`, `'public'`
   * included (the façade turns `public` into null); null or absent when none is declared.
   */
  schemaName?: string | null
}

export type PatchedLiamSchema = Omit<Schema, 'tables'> & {
  /** Keyed `schema.table` outside the default `public` schema, by the bare name inside. */
  tables: Record<string, PatchedLiamTable>
  /** Views the source declares: counted, never turned into tables. */
  ignoredViews?: number
}

/**
 * The key of a table: `schema.table` outside the default `public` schema, the bare name inside.
 * The patched Liam keys its tables this way, and the shared model names them this way.
 */
export function qualifiedTableName(schema: string | null | undefined, table: string): string {
  return schema && schema !== 'public' ? `${schema}.${table}` : table
}
