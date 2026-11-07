import type { DbSchema, Table } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import { layoutTables } from '../../src/features/diagram/layout/auto-layout'

const table = (name: string, columnCount: number): Table => ({
  name,
  schema: null,
  comment: null,
  columns: Array.from({ length: columnCount }, (_, i) => ({
    name: `c${i}`,
    type: 'text',
    notNull: true,
    default: null,
    comment: null,
    isPrimaryKey: i === 0,
    isUnique: false,
  })),
  indexes: [],
  constraints: [],
})
const link = (parent: string, child: string) => ({
  name: `${child}_${parent}_fk`,
  from: { table: parent, columns: ['c0'] },
  to: { table: child, columns: ['c1'] },
  cardinality: 'ONE_TO_MANY' as const,
})

// A fixed schema: a chain, a fork and a table on its own.
const SCHEMA: DbSchema = {
  tables: {
    users: table('users', 4),
    posts: table('posts', 5),
    comments: table('comments', 3),
    sessions: table('sessions', 2),
    settings: table('settings', 6),
  },
  enums: {},
  relationships: [link('users', 'posts'), link('posts', 'comments'), link('users', 'sessions')],
}

describe('the ungrouped layout', () => {
  it('places a fixed schema exactly where it always has (groups changed nothing for it)', async () => {
    const positions = await layoutTables(SCHEMA, Object.keys(SCHEMA.tables), 'ALL_FIELDS')
    // Recorded with the layout of the initial public release, before table groups existed.
    expect(Object.fromEntries(positions)).toEqual({
      settings: { x: 12, y: 12 },
      users: { x: 12, y: 322 },
      posts: { x: 532, y: 308 },
      sessions: { x: 532, y: 536 },
      comments: { x: 852, y: 336 },
    })
  })
})
