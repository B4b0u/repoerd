import type { DbSchema, Table } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import {
  HEADER_HEIGHT,
  ROW_HEIGHT,
  TABLE_NAME_HEIGHT,
  tableSize,
} from '../../src/features/diagram/model/dimensions'
import { buildFlow, handleId } from '../../src/features/diagram/model/to-flow'

const table = (name: string, columns: string[], fks: Table['constraints'] = []): Table => ({
  name,
  schema: null,
  comment: null,
  columns: columns.map((c) => ({
    name: c,
    type: 'uuid',
    notNull: true,
    default: null,
    comment: null,
    isPrimaryKey: c === 'id',
    isUnique: false,
  })),
  indexes: [],
  constraints: fks,
})

const schema: DbSchema = {
  tables: {
    users: table('users', ['id']),
    posts: table(
      'posts',
      ['id', 'author_id'],
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
    ),
  },
  enums: {},
  relationships: [
    {
      name: 'posts_author_fk',
      from: { table: 'users', columns: ['id'] },
      to: { table: 'posts', columns: ['author_id'] },
      cardinality: 'ONE_TO_MANY',
    },
    {
      name: 'dangling',
      from: { table: 'users', columns: ['missing_column'] },
      to: { table: 'posts', columns: ['author_id'] },
      cardinality: 'ONE_TO_MANY',
    },
  ],
}

describe('tableSize', () => {
  it('grows with the number of columns', () => {
    expect(tableSize(table('t', ['a', 'b', 'c'])).height).toBe(HEADER_HEIGHT + 3 * ROW_HEIGHT + 8)
    expect(tableSize(table('t', [])).height).toBe(HEADER_HEIGHT)
  })
})

describe('buildFlow', () => {
  it('creates one node per table at its position, sorted by name', () => {
    const { nodes } = buildFlow(schema, new Map([['users', { x: 10, y: 20 }]]))
    expect(nodes.map((n) => [n.id, n.type, n.position])).toEqual([
      ['posts', 'table', { x: 0, y: 0 }],
      ['users', 'table', { x: 10, y: 20 }],
    ])
    expect(nodes[0]?.data.foreignKeyColumns).toEqual(['author_id'])
  })

  it('links the referenced column (parent, right) to the FK column (child, left) and skips broken relationships', () => {
    const { edges } = buildFlow(schema, new Map())
    expect(edges).toEqual([
      {
        id: 'posts.posts_author_fk:0',
        source: 'users',
        sourceHandle: handleId.source('id'),
        target: 'posts',
        targetHandle: handleId.target('author_id'),
        type: 'relationship',
        domAttributes: { 'aria-hidden': true },
        data: { cardinality: 'ONE_TO_MANY' },
      },
    ])
  })

  it('returns an empty diagram for a schema without tables', () => {
    expect(buildFlow({ tables: {}, enums: {}, relationships: [] }, new Map())).toEqual({
      nodes: [],
      edges: [],
    })
  })

  it('drops the English role description React Flow gives the cards', () => {
    const { nodes } = buildFlow(schema, new Map())
    expect(nodes.every((node) => 'aria-roledescription' in (node.domAttributes ?? {}))).toBe(true)
    expect(nodes.every((node) => node.domAttributes?.['aria-roledescription'] === undefined)).toBe(
      true,
    )
  })
})

describe('buildFlow per display mode', () => {
  it('sizes nodes for the mode and attaches edges to the table when columns are hidden', () => {
    const { nodes, edges } = buildFlow(schema, new Map(), 'TABLE_NAME')
    expect(nodes[0]).toMatchObject({ width: 280, height: TABLE_NAME_HEIGHT })
    expect(nodes[0]?.data).toMatchObject({ mode: 'TABLE_NAME', columns: [], highlight: 'none' })
    expect(edges[0]).toMatchObject({
      sourceHandle: handleId.tableSource,
      targetHandle: handleId.tableTarget,
    })
  })

  it('keeps column handles for key columns and falls back to the table for hidden ones', () => {
    const byEmail: DbSchema = {
      ...schema,
      tables: {
        ...schema.tables,
        users: { ...table('users', ['id', 'email']) },
      },
      relationships: [
        {
          name: 'posts_author_email_fk',
          from: { table: 'users', columns: ['email'] },
          to: { table: 'posts', columns: ['author_id'] },
          cardinality: 'ONE_TO_MANY',
        },
      ],
    }
    const { edges } = buildFlow(byEmail, new Map(), 'KEYS_ONLY')
    expect(edges[0]).toMatchObject({
      sourceHandle: handleId.tableSource,
      targetHandle: handleId.target('author_id'),
    })
  })
})
