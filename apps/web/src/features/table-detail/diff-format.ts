import type {
  ChangeValue,
  ColumnField,
  Constraint,
  ConstraintField,
  IndexField,
} from '@repoerd/model'

export type AnyField = ColumnField | IndexField | ConstraintField

/** A changed value, as text or as a key the panel translates. */
export type DisplayValue =
  | { kind: 'text'; text: string }
  | { kind: 'key'; key: 'yes' | 'no' | 'none' | 'notNull' | 'nullable' }
  | { kind: 'constraintKind'; key: Constraint['kind'] }

const CONSTRAINT_KINDS: readonly string[] = ['primaryKey', 'foreignKey', 'unique', 'check']
const isConstraintKind = (value: string): value is Constraint['kind'] =>
  CONSTRAINT_KINDS.includes(value)

export function displayValue(field: AnyField, value: ChangeValue): DisplayValue {
  if (value === null || value === '') return { kind: 'key', key: 'none' }
  if (typeof value === 'boolean') {
    if (field === 'notNull') return { kind: 'key', key: value ? 'notNull' : 'nullable' }
    return { kind: 'key', key: value ? 'yes' : 'no' }
  }
  if (typeof value !== 'string') return { kind: 'text', text: value.join(', ') }
  if (field === 'kind' && isConstraintKind(value)) return { kind: 'constraintKind', key: value }
  // Referential actions read like the constraint details: SET_NULL → SET NULL.
  if (field === 'onDelete' || field === 'onUpdate')
    return { kind: 'text', text: value.replace(/_/g, ' ') }
  return { kind: 'text', text: value }
}
