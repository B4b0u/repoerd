import type { DbSchema, Table } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import {
  layoutRelated,
  relatedSummary,
  relatedTableNames,
  subsetSchema,
} from '../../src/features/diagram/layout/related'

const table = (name: string): Table => ({
  name,
  schema: null,
  comment: null,
  columns: [
    {
      name: 'id',
      type: 'uuid',
      notNull: true,
      default: null,
      comment: null,
      isPrimaryKey: true,
      isUnique: false,
    },
  ],
  indexes: [],
  constraints: [],
})
const rel = (parent: string, child: string) => ({
  name: `${child}_${parent}_fk`,
  from: { table: parent, columns: ['id'] },
  to: { table: child, columns: ['id'] },
  cardinality: 'ONE_TO_MANY' as const,
})

const schema: DbSchema = {
  tables: Object.fromEntries(
    ['users', 'posts', 'comments', 'tags', 'categories'].map((n) => [n, table(n)]),
  ),
  enums: {},
  relationships: [
    rel('users', 'posts'),
    rel('posts', 'comments'),
    rel('users', 'comments'),
    rel('categories', 'categories'),
  ],
}

describe('relatedTableNames', () => {
  it('returns the table and its direct neighbours in both directions', () => {
    expect(relatedTableNames(schema, 'posts')).toEqual(['posts', 'users', 'comments'])
    expect(relatedTableNames(schema, 'tags')).toEqual(['tags'])
  })

  it('lists a self-referencing table once and ignores unknown tables', () => {
    expect(relatedTableNames(schema, 'categories')).toEqual(['categories'])
    expect(relatedTableNames(schema, 'ghost')).toEqual([])
  })

  it('knows no table named like an Object member', () => {
    expect(relatedTableNames(schema, 'constructor')).toEqual([])
    expect(relatedSummary(schema, 'toString')).toEqual({ count: 0, selfReferencing: false })
  })
})

describe('relatedSummary', () => {
  it('counts the neighbours and tells whether the table references itself', () => {
    expect(relatedSummary(schema, 'posts')).toEqual({ count: 2, selfReferencing: false })
    expect(relatedSummary(schema, 'tags')).toEqual({ count: 0, selfReferencing: false })
    expect(relatedSummary(schema, 'categories')).toEqual({ count: 0, selfReferencing: true })
  })
})

describe('subsetSchema', () => {
  it('keeps only the given tables and the relationships between them', () => {
    const subset = subsetSchema(schema, ['users', 'posts'])
    expect(Object.keys(subset.tables)).toEqual(['users', 'posts'])
    expect(subset.relationships.map((r) => r.name)).toEqual(['posts_users_fk'])
  })
})

describe('layoutRelated', () => {
  it('positions exactly the related tables', async () => {
    const { schema: subset, positions } = await layoutRelated(schema, 'comments', 'ALL_FIELDS')
    expect(Object.keys(subset.tables).sort()).toEqual(['comments', 'posts', 'users'])
    expect([...positions.keys()].sort()).toEqual(['comments', 'posts', 'users'])
  })
})
