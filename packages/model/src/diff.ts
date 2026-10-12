import type {
  Column,
  Constraint,
  DbEnum,
  DbSchema,
  ForeignKeyConstraint,
  Index,
  Relationship,
  Table,
} from './schema.js'

/** How the "before" side of a branch comparison is chosen: the fork point, or the reference head. */
export type CompareMode = 'merge-base' | 'direct'

export const COMPARE_MODES: readonly CompareMode[] = ['merge-base', 'direct']

export function isCompareMode(value: unknown): value is CompareMode {
  return typeof value === 'string' && (COMPARE_MODES as readonly string[]).includes(value)
}

export type DiffStatus = 'added' | 'removed' | 'modified' | 'unchanged'

export type ChangeValue = string | boolean | null | readonly string[]

export interface FieldChange<F extends string> {
  field: F
  before: ChangeValue
  after: ChangeValue
}

export interface ItemDiff<F extends string> {
  name: string
  status: DiffStatus
  /** The fields that differ; empty unless `status` is 'modified'. */
  changes: FieldChange<F>[]
}

export type ColumnField = 'type' | 'notNull' | 'default' | 'comment' | 'isPrimaryKey' | 'isUnique'
export type IndexField = 'columns' | 'type' | 'unique'
export type ConstraintField =
  | 'kind'
  | 'columns'
  | 'targetTable'
  | 'targetColumns'
  | 'onDelete'
  | 'onUpdate'
  | 'detail'

export interface TableDiff {
  name: string
  status: DiffStatus
  /** Set when the table comment changed. */
  comment: { before: string | null; after: string | null } | null
  /** Items in the order of the union schema (see `unionSchema`). */
  columns: ItemDiff<ColumnField>[]
  indexes: ItemDiff<IndexField>[]
  constraints: ItemDiff<ConstraintField>[]
}

export interface EnumDiff {
  name: string
  status: Exclude<DiffStatus, 'unchanged'>
  addedValues: string[]
  removedValues: string[]
}

export interface DiffSummary {
  tablesAdded: number
  tablesModified: number
  tablesRemoved: number
  enumsChanged: number
}

export interface SchemaDiff {
  /** Every table of either side, unchanged ones included. */
  tables: Record<string, TableDiff>
  /** Changed enums only, sorted by name. */
  enums: EnumDiff[]
  summary: DiffSummary
  hasChanges: boolean
}

const COLUMN_FIELDS: readonly ColumnField[] = [
  'type',
  'notNull',
  'default',
  'comment',
  'isPrimaryKey',
  'isUnique',
]
const INDEX_FIELDS: readonly IndexField[] = ['columns', 'type', 'unique']
const CONSTRAINT_FIELDS: readonly ConstraintField[] = [
  'kind',
  'columns',
  'targetTable',
  'targetColumns',
  'onDelete',
  'onUpdate',
  'detail',
]

/** Records come from JSON: a table named `constructor` must not read Object.prototype. */
const own = <T>(record: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined

/**
 * The names of `after` in their order, each name found only in `before` inserted right after
 * the name that preceded it in `before` (first when nothing did).
 */
export function mergeOrder(before: readonly string[], after: readonly string[]): string[] {
  const result = [...new Set(after)]
  const placed = new Set(result)
  before.forEach((name, index) => {
    if (placed.has(name)) return
    let at = 0
    for (let previous = index - 1; previous >= 0; previous--) {
      const found = result.indexOf(before[previous] as string)
      if (found !== -1) {
        at = found + 1
        break
      }
    }
    result.splice(at, 0, name)
    placed.add(name)
  })
  return result
}

const isList = (value: ChangeValue): value is readonly string[] => Array.isArray(value)

function sameValue(a: ChangeValue, b: ChangeValue): boolean {
  if (isList(a) || isList(b)) {
    return isList(a) && isList(b) && a.length === b.length && a.every((value, i) => value === b[i])
  }
  return a === b
}

const columnValues = (column: Column): Record<ColumnField, ChangeValue> => ({
  type: column.type,
  notNull: column.notNull,
  default: column.default,
  comment: column.comment,
  isPrimaryKey: column.isPrimaryKey,
  isUnique: column.isUnique,
})

const indexValues = (index: Index): Record<IndexField, ChangeValue> => ({
  columns: index.columns,
  type: index.type,
  unique: index.unique,
})

function constraintValues(constraint: Constraint): Record<ConstraintField, ChangeValue> {
  const foreignKey = constraint.kind === 'foreignKey' ? constraint : null
  return {
    kind: constraint.kind,
    columns: constraint.kind === 'check' ? null : constraint.columns,
    targetTable: foreignKey?.targetTable ?? null,
    targetColumns: foreignKey?.targetColumns ?? null,
    onDelete: foreignKey?.onDelete ?? null,
    onUpdate: foreignKey?.onUpdate ?? null,
    detail: constraint.kind === 'check' ? constraint.detail : null,
  }
}

function diffItems<T extends { name: string }, F extends string>(
  before: readonly T[],
  after: readonly T[],
  fields: readonly F[],
  values: (item: T) => Record<F, ChangeValue>,
): ItemDiff<F>[] {
  const beforeByName = new Map(before.map((item) => [item.name, item]))
  const afterByName = new Map(after.map((item) => [item.name, item]))
  const names = mergeOrder(
    before.map((item) => item.name),
    after.map((item) => item.name),
  )
  return names.map((name): ItemDiff<F> => {
    const old = beforeByName.get(name)
    const current = afterByName.get(name)
    if (!old) return { name, status: 'added', changes: [] }
    if (!current) return { name, status: 'removed', changes: [] }
    const oldValues = values(old)
    const currentValues = values(current)
    const changes = fields
      .filter((field) => !sameValue(oldValues[field], currentValues[field]))
      .map((field) => ({ field, before: oldValues[field], after: currentValues[field] }))
    return { name, status: changes.length > 0 ? 'modified' : 'unchanged', changes }
  })
}

const foreignKeySignature = (key: ForeignKeyConstraint) =>
  JSON.stringify([key.targetTable, key.columns, key.targetColumns])

/**
 * Foreign keys whose generated name changed (a renamed Drizzle table variable or Prisma relation
 * field): a key found only in `before` and a key found only in `after`, with the same target and
 * the same ordered columns, are one key. Maps the `before` name of each such key to its `after`
 * name. Only an unambiguous match is paired: when several keys on either side share a signature,
 * there is no telling which one became which, so they stay removed and added.
 */
export function renamedForeignKeys(
  before: readonly Constraint[],
  after: readonly Constraint[],
): Map<string, string> {
  const beforeNames = new Set(before.map((constraint) => constraint.name))
  const afterNames = new Set(after.map((constraint) => constraint.name))
  const bySignature = (
    constraints: readonly Constraint[],
    otherNames: ReadonlySet<string>,
  ): Map<string, ForeignKeyConstraint[]> => {
    const groups = new Map<string, ForeignKeyConstraint[]>()
    for (const constraint of constraints) {
      if (constraint.kind !== 'foreignKey' || otherNames.has(constraint.name)) continue
      const signature = foreignKeySignature(constraint)
      groups.set(signature, [...(groups.get(signature) ?? []), constraint])
    }
    return groups
  }
  const removed = bySignature(before, afterNames)
  const added = bySignature(after, beforeNames)
  const pairs = new Map<string, string>()
  for (const [signature, olds] of removed) {
    const news = added.get(signature)
    const [old] = olds
    const [current] = news ?? []
    if (olds.length === 1 && news?.length === 1 && old && current) pairs.set(old.name, current.name)
  }
  return pairs
}

/** `constraints` with each paired foreign key under its `after` name. */
function withAfterNames(
  constraints: readonly Constraint[],
  pairs: ReadonlyMap<string, string>,
): readonly Constraint[] {
  if (pairs.size === 0) return constraints
  return constraints.map((constraint) => {
    const name = pairs.get(constraint.name)
    return name === undefined ? constraint : { ...constraint, name }
  })
}

const emptyTable = (name: string): Table => ({
  name,
  schema: null,
  comment: null,
  columns: [],
  indexes: [],
  constraints: [],
})

function diffTable(name: string, before: Table | undefined, after: Table | undefined): TableDiff {
  const old = before ?? emptyTable(name)
  const current = after ?? emptyTable(name)
  const columns = diffItems(old.columns, current.columns, COLUMN_FIELDS, columnValues)
  const indexes = diffItems(old.indexes, current.indexes, INDEX_FIELDS, indexValues)
  const pairs =
    before && after
      ? renamedForeignKeys(before.constraints, after.constraints)
      : new Map<string, string>()
  const constraints = diffItems(
    withAfterNames(old.constraints, pairs),
    current.constraints,
    CONSTRAINT_FIELDS,
    constraintValues,
  )
  const comment =
    before && after && before.comment !== after.comment
      ? { before: before.comment, after: after.comment }
      : null
  const itemChanged = [...columns, ...indexes, ...constraints].some(
    (item) => item.status !== 'unchanged',
  )
  const status: DiffStatus = !before
    ? 'added'
    : !after
      ? 'removed'
      : comment || itemChanged
        ? 'modified'
        : 'unchanged'
  return { name, status, comment, columns, indexes, constraints }
}

function diffEnums(before: Record<string, DbEnum>, after: Record<string, DbEnum>): EnumDiff[] {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
  const diffs: EnumDiff[] = []
  for (const name of names) {
    const old = own(before, name)
    const current = own(after, name)
    const oldValues = new Set(old?.values ?? [])
    const currentValues = new Set(current?.values ?? [])
    const addedValues = [...currentValues].filter((value) => !oldValues.has(value))
    const removedValues = [...oldValues].filter((value) => !currentValues.has(value))
    if (!old) diffs.push({ name, status: 'added', addedValues, removedValues: [] })
    else if (!current) diffs.push({ name, status: 'removed', addedValues: [], removedValues })
    else if (addedValues.length > 0 || removedValues.length > 0)
      diffs.push({ name, status: 'modified', addedValues, removedValues })
  }
  return diffs
}

/** What changed from `before` to `after`, matched by name at every level (no rename detection). */
export function diffSchemas(before: DbSchema, after: DbSchema): SchemaDiff {
  const names = mergeOrder(Object.keys(before.tables), Object.keys(after.tables))
  // Object.fromEntries defines own properties, even for a table named `__proto__`.
  const tables: Record<string, TableDiff> = Object.fromEntries(
    names.map((name) => [name, diffTable(name, own(before.tables, name), own(after.tables, name))]),
  )
  const enums = diffEnums(before.enums, after.enums)
  const summary: DiffSummary = {
    tablesAdded: 0,
    tablesModified: 0,
    tablesRemoved: 0,
    enumsChanged: enums.length,
  }
  for (const table of Object.values(tables)) {
    if (table.status === 'added') summary.tablesAdded++
    else if (table.status === 'modified') summary.tablesModified++
    else if (table.status === 'removed') summary.tablesRemoved++
  }
  const hasChanges =
    summary.tablesAdded + summary.tablesModified + summary.tablesRemoved + summary.enumsChanged > 0
  return { tables, enums, summary, hasChanges }
}

function unionItems<T extends { name: string }>(before: readonly T[], after: readonly T[]): T[] {
  const beforeByName = new Map(before.map((item) => [item.name, item]))
  const afterByName = new Map(after.map((item) => [item.name, item]))
  return mergeOrder(
    before.map((item) => item.name),
    after.map((item) => item.name),
  ).map((name) => (afterByName.get(name) ?? beforeByName.get(name)) as T)
}

/** Relationships are named after their foreign key, whose name is only unique within its table. */
export const relationshipKey = (relationship: Pick<Relationship, 'name' | 'to'>): string =>
  `${relationship.to.table}\u0000${relationship.name}`

/**
 * The schema a comparison draws: removed tables, columns, indexes, constraints, relationships
 * and enums come from `before`, everything else from `after`.
 */
export function unionSchema(before: DbSchema, after: DbSchema): DbSchema {
  const names = mergeOrder(Object.keys(before.tables), Object.keys(after.tables))
  // Per child table: the before name → after name of its foreign keys renamed by their generator.
  const renamed = new Map<string, ReadonlyMap<string, string>>()
  const tables: Record<string, Table> = Object.fromEntries(
    names.map((name): [string, Table] => {
      const old = own(before.tables, name)
      const current = own(after.tables, name)
      if (!old || !current) return [name, (current ?? old) as Table]
      const pairs = renamedForeignKeys(old.constraints, current.constraints)
      if (pairs.size > 0) renamed.set(name, pairs)
      return [
        name,
        {
          ...current,
          columns: unionItems(old.columns, current.columns),
          indexes: unionItems(old.indexes, current.indexes),
          constraints: unionItems(withAfterNames(old.constraints, pairs), current.constraints),
        },
      ]
    }),
  )
  const kept = new Set(after.relationships.map(relationshipKey))
  const beforeRelationships = before.relationships.map((relationship) => {
    const name = renamed.get(relationship.to.table)?.get(relationship.name)
    return name === undefined ? relationship : { ...relationship, name }
  })
  return {
    tables,
    enums: { ...before.enums, ...after.enums },
    relationships: [
      ...after.relationships,
      ...beforeRelationships.filter((relationship) => !kept.has(relationshipKey(relationship))),
    ],
  }
}

/** A relationship has the status of the foreign key it comes from. */
export function relationshipStatus(diff: SchemaDiff, relationship: Relationship): DiffStatus {
  const table = own(diff.tables, relationship.to.table)
  return table?.constraints.find((c) => c.name === relationship.name)?.status ?? 'unchanged'
}
