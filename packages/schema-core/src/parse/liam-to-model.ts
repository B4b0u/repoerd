import type { Constraint as LiamConstraint } from '@liam-hq/schema'
import {
  type Constraint,
  type DbEnum,
  type DbSchema,
  type DrizzleCasing,
  deriveRelationships,
  type Table,
} from '@repoerd/model'
import { applyCasing } from './casing.js'
import { type PatchedLiamSchema, qualifiedTableName } from './liam-patch.js'

export interface ToDbSchemaOptions {
  /** drizzle.config `casing`: renames the columns declared without a name (`firstName: text()`). */
  casing?: DrizzleCasing
}

/** Column renames of one table: old name → new name. */
type Renames = ReadonlyMap<string, string>

const renamed = (renames: Renames | undefined, columns: readonly string[]) =>
  columns.map((column) => renames?.get(column) ?? column)

/** Under a Drizzle `casing`, a column declared without a name takes its cased JS key. */
function casingRenames(
  liam: PatchedLiamSchema,
  casing: DrizzleCasing | undefined,
): Map<string, Renames> {
  const renames = new Map<string, Renames>()
  if (!casing) return renames
  for (const [key, table] of Object.entries(liam.tables)) {
    const tableRenames = new Map<string, string>()
    for (const column of Object.values(table.columns)) {
      if (column.nameExplicit === false) {
        tableRenames.set(column.name, applyCasing(casing, column.name))
      }
    }
    if (tableRenames.size > 0) renames.set(key, tableRenames)
  }
  return renames
}

function toConstraint(
  constraint: LiamConstraint,
  own: Renames | undefined,
  renames: ReadonlyMap<string, Renames>,
): Constraint {
  switch (constraint.type) {
    case 'PRIMARY KEY':
      return {
        kind: 'primaryKey',
        name: constraint.name,
        columns: renamed(own, constraint.columnNames),
      }
    case 'FOREIGN KEY':
      return {
        kind: 'foreignKey',
        name: constraint.name,
        columns: renamed(own, constraint.columnNames),
        // The patched parsers key their tables the way qualifiedTableName names them.
        targetTable: constraint.targetTableName,
        targetColumns: renamed(
          renames.get(constraint.targetTableName),
          constraint.targetColumnNames,
        ),
        onDelete: constraint.deleteConstraint,
        onUpdate: constraint.updateConstraint,
      }
    case 'UNIQUE':
      return {
        kind: 'unique',
        name: constraint.name,
        columns: renamed(own, constraint.columnNames),
      }
    case 'CHECK':
      return { kind: 'check', name: constraint.name, detail: constraint.detail }
  }
}

export function toDbSchema(liam: PatchedLiamSchema, options: ToDbSchemaOptions = {}): DbSchema {
  const renames = casingRenames(liam, options.casing)
  // Built through Maps: `tables['__proto__'] = …` would replace the prototype and lose the table.
  const tables = new Map<string, Table>()

  for (const [key, liamTable] of Object.entries(liam.tables)) {
    const own = renames.get(key)
    const schema =
      liamTable.schemaName && liamTable.schemaName !== 'public' ? liamTable.schemaName : null
    const name = qualifiedTableName(schema, liamTable.name)
    const constraints = Object.values(liamTable.constraints).map((constraint) =>
      toConstraint(constraint, own, renames),
    )
    const indexes = Object.values(liamTable.indexes).map((index) => ({
      name: index.name,
      columns: renamed(own, index.columns),
      type: index.type,
      unique: index.unique,
    }))
    const primaryKeyColumns = new Set(
      constraints.flatMap((c) => (c.kind === 'primaryKey' ? c.columns : [])),
    )
    const uniqueSingleColumns = new Set([
      ...constraints.flatMap((c) =>
        c.kind === 'unique' && c.columns.length === 1 ? c.columns : [],
      ),
      ...indexes.flatMap((i) => (i.unique && i.columns.length === 1 ? i.columns : [])),
    ])

    tables.set(name, {
      name,
      schema,
      comment: liamTable.comment,
      columns: Object.values(liamTable.columns).map((column) => {
        const columnName = own?.get(column.name) ?? column.name
        const isPrimaryKey = primaryKeyColumns.has(columnName)
        return {
          name: columnName,
          type: column.type,
          notNull: column.notNull,
          default: column.default === null ? null : String(column.default),
          comment: column.comment,
          isPrimaryKey,
          isUnique: !isPrimaryKey && uniqueSingleColumns.has(columnName),
        }
      }),
      indexes,
      constraints,
    })
  }

  const enums = new Map<string, DbEnum>()
  for (const liamEnum of Object.values(liam.enums)) {
    enums.set(liamEnum.name, { name: liamEnum.name, values: [...liamEnum.values] })
  }

  // Object.fromEntries defines own properties, "__proto__" included.
  const tableRecord = Object.fromEntries(tables)
  const ignoredViews = liam.ignoredViews ?? 0
  return {
    tables: tableRecord,
    enums: Object.fromEntries(enums),
    relationships: deriveRelationships(tableRecord),
    ...(ignoredViews > 0 ? { ignoredViews } : {}),
  }
}
