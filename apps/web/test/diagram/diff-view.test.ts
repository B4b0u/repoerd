import {
  type Column,
  type DbSchema,
  deriveRelationships,
  diffSchemas,
  type Table,
  type TableDiff,
  unionSchema,
} from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import {
  canvasHiddenTables,
  changedTables,
  columnChangeTitle,
  minimapColor,
  nodeDiff,
  tableChangeSummary,
  typeChange,
  unchangedTables,
} from '../../src/features/diagram/model/diff-view'
import { buildFlow } from '../../src/features/diagram/model/to-flow'

const column = (name: string, overrides: Partial<Column> = {}): Column => ({
  name,
  type: 'text',
  notNull: false,
  default: null,
  comment: null,
  isPrimaryKey: name === 'id',
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
const schema = (...tables: Table[]): DbSchema => {
  const byName = Object.fromEntries(tables.map((t) => [t.name, t]))
  return { tables: byName, enums: {}, relationships: deriveRelationships(byName) }
}
const fk = (onDelete: string) => ({
  kind: 'foreignKey' as const,
  name: 'posts_author_fk',
  columns: ['author_id'],
  targetTable: 'users',
  targetColumns: ['id'],
  onDelete,
  onUpdate: 'NO_ACTION',
})

const before = schema(
  table('users', [column('id'), column('nickname')]),
  table('posts', [column('id'), column('author_id'), column('body')], {
    constraints: [fk('CASCADE')],
  }),
  table('legacy', [column('id')]),
  table('audit', [column('id')]),
)
const after = schema(
  table('users', [column('id'), column('email')]),
  table('posts', [column('id'), column('author_id'), column('body', { type: 'varchar(10)' })], {
    constraints: [fk('RESTRICT')],
    indexes: [{ name: 'posts_body_idx', columns: ['body'], type: '', unique: false }],
    comment: 'Blog posts',
  }),
  table('tags', [column('id')]),
  table('audit', [column('id')]),
)
const diff = diffSchemas(before, after)

describe('diff view', () => {
  it('counts the column changes of a card, hidden columns included', () => {
    expect(nodeDiff(diff.tables.users as TableDiff)).toMatchObject({
      status: 'modified',
      counts: { added: 1, modified: 0, removed: 1 },
    })
    expect(Object.keys(nodeDiff(diff.tables.users as TableDiff).columns)).toEqual([
      'id',
      'nickname',
      'email',
    ])
  })

  it('reads the type change of a column, if any', () => {
    const [id, , body] = (diff.tables.posts as TableDiff).columns
    if (!id || !body) throw new Error('missing columns')
    expect(typeChange(body)).toEqual({ before: 'text', after: 'varchar(10)' })
    expect(typeChange(id)).toBeNull()
  })

  it('describes column changes in SQL words for the card tooltip', () => {
    expect(
      columnChangeTitle([
        { field: 'type', before: 'text', after: 'uuid' },
        { field: 'notNull', before: false, after: true },
        { field: 'default', before: null, after: 'now()' },
        { field: 'isUnique', before: true, after: false },
      ]),
    ).toEqual(['TYPE text → uuid', 'NULL → NOT NULL', 'DEFAULT ∅ → now()', '− UNIQUE'])
  })

  it('lists changed tables added first, then modified, then removed, by name', () => {
    expect(changedTables(diff).map((t) => `${t.status}:${t.name}`)).toEqual([
      'added:tags',
      'modified:posts',
      'modified:users',
      'removed:legacy',
    ])
  })

  it('summarises a modified table for the changes list', () => {
    expect(tableChangeSummary(diff.tables.posts as TableDiff)).toEqual({
      columns: { added: 0, modified: 1, removed: 0 },
      indexes: 1,
      constraints: 1,
      comment: true,
    })
  })

  it('hides unchanged tables only when asked, on top of the hidden ones', () => {
    const hidden = new Set(['tags'])
    expect(unchangedTables(diff)).toEqual(['audit'])
    expect(canvasHiddenTables(hidden, diff, false)).toBe(hidden)
    expect(canvasHiddenTables(hidden, undefined, true)).toBe(hidden)
    expect([...canvasHiddenTables(hidden, diff, true)].sort()).toEqual(['audit', 'tags'])
  })

  it('colours the minimap by status', () => {
    expect(minimapColor('added')).toBe('var(--diff-added)')
    expect(minimapColor('unchanged')).toBe('var(--header-bg)')
    expect(minimapColor(undefined)).toBe('var(--header-bg)')
  })
})

describe('buildFlow in a comparison', () => {
  it('gives each card its diff and each link the status of its foreign key', () => {
    const flow = buildFlow(unionSchema(before, after), new Map(), 'ALL_FIELDS', diff)
    expect(flow.nodes.find((n) => n.id === 'legacy')?.data.diff?.status).toBe('removed')
    expect(flow.nodes.find((n) => n.id === 'users')?.data.columns.map((c) => c.name)).toEqual([
      'id',
      'nickname',
      'email',
    ])
    expect(flow.edges.map((e) => e.data?.status)).toEqual(['modified'])
  })

  it('leaves cards and links without diff outside a comparison', () => {
    const flow = buildFlow(after, new Map())
    expect(flow.nodes.every((n) => n.data.diff === undefined)).toBe(true)
    expect(flow.edges.every((e) => e.data?.status === undefined)).toBe(true)
  })
})
