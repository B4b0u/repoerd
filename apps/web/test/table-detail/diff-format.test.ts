import { describe, expect, it } from 'vitest'
import { displayValue } from '../../src/features/table-detail/diff-format'

describe('displayValue', () => {
  it('names booleans, nullability and missing values', () => {
    expect(displayValue('notNull', true)).toEqual({ kind: 'key', key: 'notNull' })
    expect(displayValue('notNull', false)).toEqual({ kind: 'key', key: 'nullable' })
    expect(displayValue('isUnique', true)).toEqual({ kind: 'key', key: 'yes' })
    expect(displayValue('unique', false)).toEqual({ kind: 'key', key: 'no' })
    expect(displayValue('default', null)).toEqual({ kind: 'key', key: 'none' })
    expect(displayValue('type', '')).toEqual({ kind: 'key', key: 'none' })
  })

  it('writes lists, constraint kinds and referential actions', () => {
    expect(displayValue('columns', ['a', 'b'])).toEqual({ kind: 'text', text: 'a, b' })
    expect(displayValue('kind', 'foreignKey')).toEqual({
      kind: 'constraintKind',
      key: 'foreignKey',
    })
    expect(displayValue('onDelete', 'SET_NULL')).toEqual({ kind: 'text', text: 'SET NULL' })
    expect(displayValue('type', 'uuid')).toEqual({ kind: 'text', text: 'uuid' })
  })
})
