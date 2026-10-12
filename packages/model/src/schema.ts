export type SchemaFormat = 'prisma' | 'drizzle'

export interface Column {
  name: string
  type: string
  notNull: boolean
  default: string | null
  comment: string | null
  isPrimaryKey: boolean
  isUnique: boolean
}

export interface Index {
  name: string
  columns: string[]
  type: string
  unique: boolean
}

export interface PrimaryKeyConstraint {
  kind: 'primaryKey'
  name: string
  columns: string[]
}

export interface ForeignKeyConstraint {
  kind: 'foreignKey'
  name: string
  columns: string[]
  targetTable: string
  targetColumns: string[]
  onDelete: string
  onUpdate: string
}

export interface UniqueConstraint {
  kind: 'unique'
  name: string
  columns: string[]
}

export interface CheckConstraint {
  kind: 'check'
  name: string
  detail: string
}

export type Constraint =
  | PrimaryKeyConstraint
  | ForeignKeyConstraint
  | UniqueConstraint
  | CheckConstraint

export interface Table {
  /** Key of the table in the schema: `schema.table` outside the default `public` schema. */
  name: string
  /** The Postgres schema the table is declared in; null for `public` or no declared schema. */
  schema: string | null
  comment: string | null
  columns: Column[]
  indexes: Index[]
  constraints: Constraint[]
}

export interface DbEnum {
  name: string
  values: string[]
}

/** `from` is the referenced (parent) side, `to` the referencing (child) side holding the FK. */
export interface Relationship {
  name: string
  from: { table: string; columns: string[] }
  to: { table: string; columns: string[] }
  cardinality: 'ONE_TO_ONE' | 'ONE_TO_MANY'
}

export interface DbSchema {
  tables: Record<string, Table>
  enums: Record<string, DbEnum>
  relationships: Relationship[]
  /** Views the source declares: never drawn, only counted. Absent when there is none. */
  ignoredViews?: number
}
