import type { Column } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import { columnTraits, describeConstraint } from '../../src/features/table-detail/format'

const column = (overrides: Partial<Column>): Column => ({
  name: 'c',
  type: 'text',
  notNull: false,
  default: null,
  comment: null,
  isPrimaryKey: false,
  isUnique: false,
  ...overrides,
})

describe('columnTraits', () => {
  it('lists key, uniqueness and nullability traits in a stable order', () => {
    expect(columnTraits(column({ isPrimaryKey: true, notNull: true }), false)).toEqual([
      'primaryKey',
      'notNull',
    ])
    expect(columnTraits(column({ isUnique: true }), true)).toEqual([
      'foreignKey',
      'unique',
      'nullable',
    ])
  })
})

describe('describeConstraint', () => {
  it('describes foreign keys with their target and referential actions', () => {
    expect(
      describeConstraint({
        kind: 'foreignKey',
        name: 'posts_author_fk',
        columns: ['author_id'],
        targetTable: 'users',
        targetColumns: ['id'],
        onDelete: 'CASCADE',
        onUpdate: 'NO_ACTION',
      }),
    ).toEqual({
      kind: 'foreignKey',
      name: 'posts_author_fk',
      detail: 'author_id → users.id · ON DELETE CASCADE · ON UPDATE NO ACTION',
    })
  })

  it('describes primary keys, unique and check constraints', () => {
    expect(describeConstraint({ kind: 'primaryKey', name: 'pk', columns: ['a', 'b'] })).toEqual({
      kind: 'primaryKey',
      name: 'pk',
      detail: 'a, b',
    })
    expect(describeConstraint({ kind: 'unique', name: 'uq', columns: ['email'] }).kind).toBe(
      'unique',
    )
    expect(describeConstraint({ kind: 'check', name: 'ck', detail: 'price > 0' })).toEqual({
      kind: 'check',
      name: 'ck',
      detail: 'price > 0',
    })
  })
})
