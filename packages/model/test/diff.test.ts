import { describe, expect, it } from 'vitest'
import {
  diffSchemas,
  isCompareMode,
  mergeOrder,
  relationshipKey,
  relationshipStatus,
  unionSchema,
} from '../src/diff.js'
import { deriveRelationships } from '../src/relationships.js'
import type { Column, Constraint, DbEnum, DbSchema, Index, Table } from '../src/schema.js'

const column = (name: string, overrides: Partial<Column> = {}): Column => ({
  name,
  type: 'text',
  notNull: false,
  default: null,
  comment: null,
  isPrimaryKey: false,
  isUnique: false,
  ...overrides,
})

const table = (name: string, columns: Column[], extra: Partial<Table> = {}): Table => ({
  name,
  schema: null,
  comment: null,
  columns,
  indexes: [],
  constraints: [],
  ...extra,
})

const fk = (
  name: string,
  columns: string[],
  targetTable: string,
  overrides: { onDelete?: string; onUpdate?: string; targetColumns?: string[] } = {},
): Constraint => ({
  kind: 'foreignKey',
  name,
  columns,
  targetTable,
  targetColumns: overrides.targetColumns ?? ['id'],
  onDelete: overrides.onDelete ?? 'CASCADE',
  onUpdate: overrides.onUpdate ?? 'NO_ACTION',
})

const schema = (tables: Table[], enums: DbEnum[] = []): DbSchema => {
  const byName = Object.fromEntries(tables.map((t) => [t.name, t]))
  return {
    tables: byName,
    enums: Object.fromEntries(enums.map((e) => [e.name, e])),
    relationships: deriveRelationships(byName),
  }
}

const users = table('users', [column('id', { isPrimaryKey: true }), column('email')])

describe('isCompareMode', () => {
  it('accepts the two modes only', () => {
    expect(isCompareMode('merge-base')).toBe(true)
    expect(isCompareMode('direct')).toBe(true)
    expect(isCompareMode('both')).toBe(false)
    expect(isCompareMode(undefined)).toBe(false)
  })
})

describe('mergeOrder', () => {
  it('keeps the after order and puts each removed name after the one that preceded it', () => {
    expect(mergeOrder(['a', 'b', 'c', 'd'], ['a', 'c', 'e'])).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('puts removed names without predecessor first, in their order', () => {
    expect(mergeOrder(['x', 'y', 'a'], ['a', 'b'])).toEqual(['x', 'y', 'a', 'b'])
  })

  it('drops duplicates', () => {
    expect(mergeOrder(['a', 'a'], ['b', 'b'])).toEqual(['a', 'b'])
  })
})

describe('diffSchemas', () => {
  it('finds nothing between equal schemas', () => {
    const diff = diffSchemas(schema([users]), schema([users]))
    expect(diff.hasChanges).toBe(false)
    expect(diff.tables.users?.status).toBe('unchanged')
    expect(diff.tables.users?.columns.map((c) => c.status)).toEqual(['unchanged', 'unchanged'])
    expect(diff.summary).toEqual({
      tablesAdded: 0,
      tablesModified: 0,
      tablesRemoved: 0,
      enumsChanged: 0,
    })
    expect(diff.enums).toEqual([])
  })

  it('reports added and removed tables with every item added or removed', () => {
    const posts = table('posts', [column('id')], {
      indexes: [{ name: 'posts_pkey', columns: ['id'], type: '', unique: true }],
    })
    const diff = diffSchemas(schema([users]), schema([posts]))
    expect(diff.tables.posts).toMatchObject({ status: 'added', comment: null })
    expect(diff.tables.posts?.columns).toEqual([{ name: 'id', status: 'added', changes: [] }])
    expect(diff.tables.posts?.indexes).toEqual([
      { name: 'posts_pkey', status: 'added', changes: [] },
    ])
    expect(diff.tables.users?.status).toBe('removed')
    expect(diff.tables.users?.columns.map((c) => c.status)).toEqual(['removed', 'removed'])
    expect(diff.summary).toMatchObject({ tablesAdded: 1, tablesRemoved: 1, tablesModified: 0 })
    expect(diff.hasChanges).toBe(true)
  })

  it.each([
    ['type', { type: 'varchar(10)' }, 'text', 'varchar(10)'],
    ['notNull', { notNull: true }, false, true],
    ['default', { default: 'now()' }, null, 'now()'],
    ['comment', { comment: 'Login' }, null, 'Login'],
    ['isPrimaryKey', { isPrimaryKey: true }, false, true],
    ['isUnique', { isUnique: true }, false, true],
  ] as const)('reports a changed column %s with its values', (field, change, before, after) => {
    const changed = table('users', [column('id', { isPrimaryKey: true }), column('email', change)])
    const diff = diffSchemas(schema([users]), schema([changed]))
    expect(diff.tables.users?.status).toBe('modified')
    expect(diff.tables.users?.columns[1]).toEqual({
      name: 'email',
      status: 'modified',
      changes: [{ field, before, after }],
    })
    expect(diff.summary.tablesModified).toBe(1)
  })

  it('ignores the column order', () => {
    const reordered = table('users', [column('email'), column('id', { isPrimaryKey: true })])
    expect(diffSchemas(schema([users]), schema([reordered])).hasChanges).toBe(false)
  })

  it('reports a changed table comment', () => {
    const commented = table('users', users.columns, { comment: 'Accounts' })
    const diff = diffSchemas(schema([users]), schema([commented]))
    expect(diff.tables.users).toMatchObject({
      status: 'modified',
      comment: { before: null, after: 'Accounts' },
    })
  })

  it('compares index columns in order, type and uniqueness', () => {
    const index = (overrides: Partial<Index>): Index => ({
      name: 'users_idx',
      columns: ['email', 'id'],
      type: 'btree',
      unique: false,
      ...overrides,
    })
    const before = schema([table('users', users.columns, { indexes: [index({})] })])
    const after = schema([
      table('users', users.columns, {
        indexes: [index({ columns: ['id', 'email'], type: 'hash', unique: true })],
      }),
    ])
    expect(diffSchemas(before, after).tables.users?.indexes).toEqual([
      {
        name: 'users_idx',
        status: 'modified',
        changes: [
          { field: 'columns', before: ['email', 'id'], after: ['id', 'email'] },
          { field: 'type', before: 'btree', after: 'hash' },
          { field: 'unique', before: false, after: true },
        ],
      },
    ])
  })

  it('compares constraints by name: actions, kind and check expression', () => {
    const posts = (constraints: Constraint[]) =>
      table('posts', [column('id'), column('author_id')], { constraints })
    const before = schema([
      users,
      posts([
        fk('posts_author_fk', ['author_id'], 'users'),
        { kind: 'unique', name: 'posts_one', columns: ['id'] },
        { kind: 'check', name: 'posts_check', detail: 'id > 0' },
      ]),
    ])
    const after = schema([
      users,
      posts([
        fk('posts_author_fk', ['author_id'], 'users', { onDelete: 'RESTRICT' }),
        { kind: 'primaryKey', name: 'posts_one', columns: ['id'] },
        { kind: 'check', name: 'posts_check', detail: 'id >= 0' },
      ]),
    ])
    expect(diffSchemas(before, after).tables.posts?.constraints).toEqual([
      {
        name: 'posts_author_fk',
        status: 'modified',
        changes: [{ field: 'onDelete', before: 'CASCADE', after: 'RESTRICT' }],
      },
      {
        name: 'posts_one',
        status: 'modified',
        changes: [{ field: 'kind', before: 'unique', after: 'primaryKey' }],
      },
      {
        name: 'posts_check',
        status: 'modified',
        changes: [{ field: 'detail', before: 'id > 0', after: 'id >= 0' }],
      },
    ])
  })

  it('keeps statuses per table when constraint names repeat across tables', () => {
    const pk = (columns: string[]): Constraint => ({
      kind: 'primaryKey',
      name: 'PRIMARY_id',
      columns,
    })
    const before = schema([
      table('users', users.columns, { constraints: [pk(['id'])] }),
      table('tags', [column('id'), column('code')], { constraints: [pk(['id'])] }),
    ])
    const after = schema([
      table('users', users.columns, { constraints: [pk(['id'])] }),
      table('tags', [column('id'), column('code')], { constraints: [pk(['code'])] }),
    ])
    const diff = diffSchemas(before, after)
    expect(diff.tables.users?.status).toBe('unchanged')
    expect(diff.tables.tags?.constraints[0]?.status).toBe('modified')
  })

  it('reports enums added, removed and with values added or removed, ignoring their order', () => {
    const before = schema(
      [users],
      [
        { name: 'status', values: ['a', 'b'] },
        { name: 'gone', values: ['x'] },
        { name: 'same', values: ['p', 'q'] },
      ],
    )
    const after = schema(
      [users],
      [
        { name: 'status', values: ['b', 'c'] },
        { name: 'fresh', values: ['y'] },
        { name: 'same', values: ['q', 'p'] },
      ],
    )
    const diff = diffSchemas(before, after)
    expect(diff.enums).toEqual([
      { name: 'fresh', status: 'added', addedValues: ['y'], removedValues: [] },
      { name: 'gone', status: 'removed', addedValues: [], removedValues: ['x'] },
      { name: 'status', status: 'modified', addedValues: ['c'], removedValues: ['a'] },
    ])
    expect(diff.summary.enumsChanged).toBe(3)
    expect(diff.hasChanges).toBe(true)
  })

  it('handles tables named like Object members', () => {
    const diff = diffSchemas(schema([]), schema([table('constructor', [column('id')])]))
    expect(Object.hasOwn(diff.tables, 'constructor')).toBe(true)
    const own = Object.entries(diff.tables).find(([name]) => name === 'constructor')?.[1]
    expect(own?.status).toBe('added')
    expect(diff.summary.tablesAdded).toBe(1)
  })
})

describe('diffSchemas — foreign keys whose generated name changed', () => {
  const posts = (constraint: Constraint) =>
    table('posts', [column('id'), column('author_id')], { constraints: [constraint] })

  it('pairs a removed and an added foreign key with the same columns and target', () => {
    const before = schema([users, posts(fk('posts_author_id_users_id_fk', ['author_id'], 'users'))])
    const after = schema([
      users,
      posts(fk('posts_authorId_fk', ['author_id'], 'users', { onDelete: 'RESTRICT' })),
    ])
    expect(diffSchemas(before, after).tables.posts?.constraints).toEqual([
      {
        name: 'posts_authorId_fk',
        status: 'modified',
        changes: [{ field: 'onDelete', before: 'CASCADE', after: 'RESTRICT' }],
      },
    ])
  })

  it('shows no change when only the generated name changed', () => {
    const before = schema([users, posts(fk('PostToUser', ['author_id'], 'users'))])
    const after = schema([users, posts(fk('PostAuthor', ['author_id'], 'users'))])
    const diff = diffSchemas(before, after)
    expect(diff.hasChanges).toBe(false)
    expect(diff.tables.posts?.constraints).toEqual([
      { name: 'PostAuthor', status: 'unchanged', changes: [] },
    ])
  })

  it('keeps foreign keys with other columns or another target apart', () => {
    const before = schema([users, posts(fk('old_fk', ['author_id'], 'users'))])
    const after = schema([
      users,
      posts(fk('new_fk', ['author_id'], 'users', { targetColumns: ['email'] })),
    ])
    expect(
      diffSchemas(before, after).tables.posts?.constraints.map((c) => [c.name, c.status]),
    ).toEqual([
      ['old_fk', 'removed'],
      ['new_fk', 'added'],
    ])
  })

  it('does not pair when several keys share the same signature (1 to 2)', () => {
    const before = schema([users, posts(fk('old_fk', ['author_id'], 'users'))])
    const after = schema([
      users,
      table('posts', [column('id'), column('author_id')], {
        constraints: [fk('new_a', ['author_id'], 'users'), fk('new_b', ['author_id'], 'users')],
      }),
    ])
    expect(
      diffSchemas(before, after).tables.posts?.constraints.map((c) => [c.name, c.status]),
    ).toEqual([
      ['old_fk', 'removed'],
      ['new_a', 'added'],
      ['new_b', 'added'],
    ])
  })

  it('does not pair two keys against two keys with the same signature (2 to 2)', () => {
    const two = (a: string, b: string) =>
      table('posts', [column('id'), column('author_id')], {
        constraints: [fk(a, ['author_id'], 'users'), fk(b, ['author_id'], 'users')],
      })
    const diff = diffSchemas(schema([users, two('o1', 'o2')]), schema([users, two('n1', 'n2')]))
    expect(diff.tables.posts?.constraints.map((c) => c.status).sort()).toEqual([
      'added',
      'added',
      'removed',
      'removed',
    ])
  })

  it('does not pair keys whose column order differs', () => {
    const composite = (name: string, columns: string[]) =>
      table('posts', [column('a'), column('b')], {
        constraints: [fk(name, columns, 'users', { targetColumns: columns })],
      })
    const diff = diffSchemas(
      schema([users, composite('old_fk', ['a', 'b'])]),
      schema([users, composite('new_fk', ['b', 'a'])]),
    )
    expect(diff.tables.posts?.constraints.map((c) => [c.name, c.status])).toEqual([
      ['old_fk', 'removed'],
      ['new_fk', 'added'],
    ])
  })

  it('pairs a renamed composite foreign key', () => {
    const composite = (name: string) =>
      table('posts', [column('a'), column('b')], {
        constraints: [fk(name, ['a', 'b'], 'users', { targetColumns: ['x', 'y'] })],
      })
    const diff = diffSchemas(
      schema([users, composite('old_fk')]),
      schema([users, composite('new_fk')]),
    )
    expect(diff.hasChanges).toBe(false)
    expect(diff.tables.posts?.constraints.map((c) => c.name)).toEqual(['new_fk'])
  })

  it('draws both relationships when the target of a renamed key changed', () => {
    const teams = table('teams', [column('id', { isPrimaryKey: true })])
    const before = schema([users, teams, posts(fk('old_fk', ['author_id'], 'users'))])
    const after = schema([users, teams, posts(fk('new_fk', ['author_id'], 'teams'))])
    expect(
      unionSchema(before, after)
        .relationships.map((r) => r.name)
        .sort(),
    ).toEqual(['new_fk', 'old_fk'])
  })

  it('draws one relationship for a renamed foreign key in a comparison', () => {
    const before = schema([users, posts(fk('PostToUser', ['author_id'], 'users'))])
    const after = schema([
      users,
      posts(fk('PostAuthor', ['author_id'], 'users', { onDelete: 'RESTRICT' })),
    ])
    const union = unionSchema(before, after)
    expect(union.tables.posts?.constraints.map((c) => c.name)).toEqual(['PostAuthor'])
    expect(union.relationships.map((r) => r.name)).toEqual(['PostAuthor'])
    const [relationship] = union.relationships
    if (!relationship) throw new Error('missing relationship')
    expect(relationshipStatus(diffSchemas(before, after), relationship)).toBe('modified')
  })
})

describe('unionSchema', () => {
  it('keeps removed tables and columns, a removed column after the one that preceded it', () => {
    const before = schema([
      table('users', [column('id'), column('nickname'), column('email')]),
      table('legacy', [column('id')]),
    ])
    const after = schema([table('users', [column('id'), column('email', { notNull: true })])])
    const union = unionSchema(before, after)
    expect(Object.keys(union.tables).sort()).toEqual(['legacy', 'users'])
    expect(union.tables.users?.columns.map((c) => c.name)).toEqual(['id', 'nickname', 'email'])
    // Kept items come from the after side.
    expect(union.tables.users?.columns[2]?.notNull).toBe(true)
  })

  it('keeps the relationships of both sides, after side first, keyed by their child table', () => {
    const before = schema([
      users,
      table('posts', [column('id'), column('author_id')], {
        constraints: [fk('author_fk', ['author_id'], 'users')],
      }),
      table('notes', [column('id'), column('author_id')], {
        constraints: [fk('author_fk', ['author_id'], 'users')],
      }),
    ])
    const after = schema([
      users,
      table('posts', [column('id'), column('author_id')], {
        constraints: [fk('author_fk', ['author_id'], 'users', { onDelete: 'RESTRICT' })],
      }),
    ])
    const union = unionSchema(before, after)
    expect(union.relationships.map(relationshipKey)).toEqual([
      relationshipKey({ name: 'author_fk', to: { table: 'posts', columns: [] } }),
      relationshipKey({ name: 'author_fk', to: { table: 'notes', columns: [] } }),
    ])
    const diff = diffSchemas(before, after)
    const [posts, notes] = union.relationships
    if (!posts || !notes) throw new Error('missing relationships')
    expect(relationshipStatus(diff, posts)).toBe('modified')
    expect(relationshipStatus(diff, notes)).toBe('removed')
  })

  it('merges the enums of both sides', () => {
    const before = schema([], [{ name: 'old', values: ['a'] }])
    const after = schema([], [{ name: 'new', values: ['b'] }])
    expect(Object.keys(unionSchema(before, after).enums).sort()).toEqual(['new', 'old'])
  })
})
