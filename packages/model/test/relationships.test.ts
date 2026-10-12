import { describe, expect, it } from 'vitest'
import { deriveRelationships, isUniqueColumnSet } from '../src/relationships.js'
import type { Column, Constraint, Table } from '../src/schema.js'

const column = (name: string, overrides: Partial<Column> = {}): Column => ({
  name,
  type: 'uuid',
  notNull: true,
  default: null,
  comment: null,
  isPrimaryKey: false,
  isUnique: false,
  ...overrides,
})

const table = (name: string, columns: Column[], constraints: Constraint[] = []): Table => ({
  name,
  schema: null,
  comment: null,
  columns,
  indexes: [],
  constraints,
})

const users = table(
  'users',
  [column('id', { isPrimaryKey: true })],
  [{ kind: 'primaryKey', name: 'users_pk', columns: ['id'] }],
)

describe('deriveRelationships', () => {
  it('ignores foreign keys to tables named like Object members that do not exist', () => {
    const posts = table(
      'posts',
      [column('id', { isPrimaryKey: true }), column('owner_id')],
      [
        {
          kind: 'foreignKey',
          name: 'posts_owner_fk',
          columns: ['owner_id'],
          targetTable: 'constructor',
          targetColumns: ['id'],
          onDelete: 'CASCADE',
          onUpdate: 'NO_ACTION',
        },
      ],
    )
    expect(deriveRelationships({ users, posts })).toEqual([])
  })

  it('creates a one-to-many relationship from the referenced table to the referencing table', () => {
    const posts = table(
      'posts',
      [column('id', { isPrimaryKey: true }), column('author_id')],
      [
        {
          kind: 'foreignKey',
          name: 'posts_author_fk',
          columns: ['author_id'],
          targetTable: 'users',
          targetColumns: ['id'],
          onDelete: 'CASCADE',
          onUpdate: 'NO_ACTION',
        },
      ],
    )

    expect(deriveRelationships({ users, posts })).toEqual([
      {
        name: 'posts_author_fk',
        from: { table: 'users', columns: ['id'] },
        to: { table: 'posts', columns: ['author_id'] },
        cardinality: 'ONE_TO_MANY',
      },
    ])
  })

  it('marks the relationship one-to-one when the FK columns are unique', () => {
    const profiles = table(
      'profiles',
      [column('user_id', { isUnique: true })],
      [
        {
          kind: 'foreignKey',
          name: 'profiles_user_fk',
          columns: ['user_id'],
          targetTable: 'users',
          targetColumns: ['id'],
          onDelete: 'NO_ACTION',
          onUpdate: 'NO_ACTION',
        },
      ],
    )

    expect(deriveRelationships({ users, profiles })[0]?.cardinality).toBe('ONE_TO_ONE')
  })

  it('skips foreign keys whose target table is not part of the schema', () => {
    const orphans = table(
      'orphans',
      [column('ghost_id')],
      [
        {
          kind: 'foreignKey',
          name: 'orphans_ghost_fk',
          columns: ['ghost_id'],
          targetTable: 'ghosts',
          targetColumns: ['id'],
          onDelete: 'NO_ACTION',
          onUpdate: 'NO_ACTION',
        },
      ],
    )

    expect(deriveRelationships({ orphans })).toEqual([])
  })
})

describe('isUniqueColumnSet', () => {
  it('recognises composite unique constraints regardless of column order', () => {
    const memberships = table(
      'memberships',
      [column('org_id'), column('user_id')],
      [{ kind: 'unique', name: 'memberships_unique', columns: ['user_id', 'org_id'] }],
    )

    expect(isUniqueColumnSet(memberships, ['org_id', 'user_id'])).toBe(true)
    expect(isUniqueColumnSet(memberships, ['org_id'])).toBe(false)
  })

  it('recognises unique indexes', () => {
    const accounts = table('accounts', [column('email')])
    accounts.indexes.push({
      name: 'accounts_email_idx',
      columns: ['email'],
      type: '',
      unique: true,
    })

    expect(isUniqueColumnSet(accounts, ['email'])).toBe(true)
  })

  it('does not take one column of a composite primary key for a unique column', () => {
    const lines = table(
      'order_lines',
      [column('order_id', { isPrimaryKey: true }), column('product_id', { isPrimaryKey: true })],
      [
        { kind: 'primaryKey', name: 'order_lines_pkey', columns: ['order_id', 'product_id'] },
        {
          kind: 'foreignKey',
          name: 'order_lines_order_fk',
          columns: ['order_id'],
          targetTable: 'users',
          targetColumns: ['id'],
          onDelete: 'CASCADE',
          onUpdate: 'NO_ACTION',
        },
      ],
    )

    expect(isUniqueColumnSet(lines, ['order_id'])).toBe(false)
    expect(isUniqueColumnSet(lines, ['product_id', 'order_id'])).toBe(true)
    expect(deriveRelationships({ users, order_lines: lines })[0]?.cardinality).toBe('ONE_TO_MANY')
  })

  it('draws a foreign key covering the whole composite primary key as one-to-one', () => {
    const lines = table(
      'order_lines',
      [column('order_id', { isPrimaryKey: true }), column('product_id', { isPrimaryKey: true })],
      [{ kind: 'primaryKey', name: 'order_lines_pkey', columns: ['order_id', 'product_id'] }],
    )
    const details = table(
      'line_details',
      [column('order_id'), column('product_id')],
      [
        { kind: 'primaryKey', name: 'line_details_pkey', columns: ['order_id', 'product_id'] },
        {
          kind: 'foreignKey',
          name: 'line_details_fk',
          columns: ['order_id', 'product_id'],
          targetTable: 'order_lines',
          targetColumns: ['order_id', 'product_id'],
          onDelete: 'CASCADE',
          onUpdate: 'NO_ACTION',
        },
      ],
    )
    expect(deriveRelationships({ order_lines: lines, line_details: details })[0]?.cardinality).toBe(
      'ONE_TO_ONE',
    )
  })

  it('still trusts the primary key flag of a table without primary key constraint', () => {
    expect(isUniqueColumnSet(table('tags', [column('id', { isPrimaryKey: true })]), ['id'])).toBe(
      true,
    )
  })
})
