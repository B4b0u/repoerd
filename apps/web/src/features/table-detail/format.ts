import type { Column, Constraint } from '@repoerd/model'

export type ColumnTrait = 'primaryKey' | 'foreignKey' | 'unique' | 'notNull' | 'nullable'

export function columnTraits(column: Column, isForeignKey: boolean): ColumnTrait[] {
  const traits: ColumnTrait[] = []
  if (column.isPrimaryKey) traits.push('primaryKey')
  if (isForeignKey) traits.push('foreignKey')
  if (column.isUnique) traits.push('unique')
  traits.push(column.notNull ? 'notNull' : 'nullable')
  return traits
}

const action = (value: string) => value.replace(/_/g, ' ')

/** The kind is translated by the panel; the detail is SQL, shown as it is. */
export function describeConstraint(constraint: Constraint): {
  kind: Constraint['kind']
  name: string
  detail: string
} {
  switch (constraint.kind) {
    case 'primaryKey':
    case 'unique':
      return { kind: constraint.kind, name: constraint.name, detail: constraint.columns.join(', ') }
    case 'check':
      return { kind: 'check', name: constraint.name, detail: constraint.detail }
    case 'foreignKey':
      return {
        kind: 'foreignKey',
        name: constraint.name,
        detail: `${constraint.columns.join(', ')} → ${constraint.targetTable}.${constraint.targetColumns.join(', ')} · ON DELETE ${action(constraint.onDelete)} · ON UPDATE ${action(constraint.onUpdate)}`,
      }
  }
}
