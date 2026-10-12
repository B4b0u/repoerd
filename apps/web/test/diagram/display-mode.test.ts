import type { Column, Table } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import {
  HEADER_HEIGHT,
  ROW_HEIGHT,
  TABLE_NAME_HEIGHT,
  tableSize,
} from '../../src/features/diagram/model/dimensions'
import { defaultDisplayMode, visibleColumns } from '../../src/features/diagram/model/display-mode'

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

const posts: Table = {
  name: 'posts',
  schema: null,
  comment: null,
  columns: [column('id', { isPrimaryKey: true }), column('author_id'), column('title')],
  indexes: [],
  constraints: [
    {
      kind: 'foreignKey',
      name: 'posts_author_fk',
      columns: ['author_id'],
      targetTable: 'users',
      targetColumns: ['id'],
      onDelete: 'NO_ACTION',
      onUpdate: 'NO_ACTION',
    },
  ],
}

describe('defaultDisplayMode', () => {
  it('shows every column up to 30 tables and only names above', () => {
    expect(defaultDisplayMode(1)).toBe('ALL_FIELDS')
    expect(defaultDisplayMode(30)).toBe('ALL_FIELDS')
    expect(defaultDisplayMode(31)).toBe('TABLE_NAME')
  })
})

describe('visibleColumns', () => {
  it('keeps every column, only keys, or none', () => {
    expect(visibleColumns(posts, 'ALL_FIELDS').map((c) => c.name)).toEqual([
      'id',
      'author_id',
      'title',
    ])
    expect(visibleColumns(posts, 'KEYS_ONLY').map((c) => c.name)).toEqual(['id', 'author_id'])
    expect(visibleColumns(posts, 'TABLE_NAME')).toEqual([])
  })
})

describe('tableSize per mode', () => {
  it('matches what the card renders in each mode', () => {
    expect(tableSize(posts).height).toBe(HEADER_HEIGHT + 3 * ROW_HEIGHT + 8)
    expect(tableSize(posts, 'KEYS_ONLY').height).toBe(HEADER_HEIGHT + 2 * ROW_HEIGHT + 8)
    expect(tableSize(posts, 'TABLE_NAME').height).toBe(TABLE_NAME_HEIGHT)
    expect(tableSize({ ...posts, columns: [], constraints: [] }).height).toBe(HEADER_HEIGHT)
  })
})
