import type { DbSchema, Table } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import { NEW_TABLES_GAP, placeTables } from '../../src/features/diagram/layout/place-tables'
import { type Point, tableSize } from '../../src/features/diagram/model/dimensions'

const table = (name: string, columnCount = 3): Table => ({
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

function schemaOf(names: string[], links: [string, string][] = []): DbSchema {
  return {
    tables: Object.fromEntries(names.map((n) => [n, table(n)])),
    enums: {},
    relationships: links.map(([parent, child]) => ({
      name: `${child}_${parent}_fk`,
      from: { table: parent, columns: ['c0'] },
      to: { table: child, columns: ['c1'] },
      cardinality: 'ONE_TO_MANY' as const,
    })),
  }
}

function overlaps(schema: DbSchema, positions: Map<string, Point>): boolean {
  const boxes = [...positions].map(([name, p]) => {
    const size = tableSize(schema.tables[name] as Table)
    return { x1: p.x, y1: p.y, x2: p.x + size.width, y2: p.y + size.height }
  })
  return boxes.some((a, i) =>
    boxes.some((b, j) => i < j && a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2),
  )
}

describe('placeTables', () => {
  it('lays out every table on a first visit, without overlaps, and returns them all as added', async () => {
    const schema = schemaOf(
      ['users', 'posts', 'comments'],
      [
        ['users', 'posts'],
        ['posts', 'comments'],
      ],
    )
    const { positions, added } = await placeTables(schema, [])

    expect([...positions.keys()].sort()).toEqual(['comments', 'posts', 'users'])
    expect(added).toHaveLength(3)
    expect(overlaps(schema, positions)).toBe(false)
    expect((positions.get('users') as Point).x).toBeLessThan((positions.get('posts') as Point).x)
  })

  it('keeps saved positions and places new tables to the right of the existing ones', async () => {
    const schema = schemaOf(['users', 'posts', 'reviews'])
    const saved = [
      { table: 'users', x: 0, y: 100 },
      { table: 'posts', x: 400, y: 50 },
    ]
    const { positions, added } = await placeTables(schema, saved)

    expect(positions.get('users')).toEqual({ x: 0, y: 100 })
    expect(positions.get('posts')).toEqual({ x: 400, y: 50 })
    expect(added.map((p) => p.table)).toEqual(['reviews'])
    expect(added[0]?.x).toBe(400 + tableSize(table('posts')).width + NEW_TABLES_GAP)
    expect(added[0]?.y).toBe(50)
  })

  it('ignores saved positions of tables that are not in this schema', async () => {
    const schema = schemaOf(['users'])
    const { positions, added } = await placeTables(schema, [
      { table: 'users', x: 5, y: 5 },
      { table: 'only_on_another_branch', x: 9, y: 9 },
    ])

    expect([...positions.keys()]).toEqual(['users'])
    expect(added).toEqual([])
  })

  it('never overlaps tables when a child references both its parent and grandparent', async () => {
    const schema = schemaOf(
      ['users', 'posts', 'comments'],
      [
        ['users', 'posts'],
        ['posts', 'comments'],
        ['users', 'comments'],
      ],
    )
    const { positions } = await placeTables(schema, [])

    expect(overlaps(schema, positions)).toBe(false)
  })

  it('keeps small schemas on a single left-to-right row (parents before children)', async () => {
    const schema = schemaOf(
      ['users', 'posts', 'comments'],
      [
        ['users', 'posts'],
        ['posts', 'comments'],
        ['users', 'comments'],
      ],
    )
    const { positions } = await placeTables(schema, [])
    const x = (name: string) => (positions.get(name) as Point).x

    expect(x('users')).toBeLessThan(x('posts'))
    expect(x('posts')).toBeLessThan(x('comments'))
  })

  it('wraps long chains of tables instead of laying them out on a single row', async () => {
    const names = Array.from({ length: 100 }, (_, i) => `t${i}`)
    const links = names.slice(1).map((name, i): [string, string] => [names[i] as string, name])
    const schema = schemaOf(names, links)
    const { positions } = await placeTables(schema, [])

    const xs = [...positions.values()].map((p) => p.x)
    const ys = [...positions.values()].map((p) => p.y)
    const width = Math.max(...xs) - Math.min(...xs)
    const height = Math.max(...ys) - Math.min(...ys)
    expect(width / Math.max(height, 1)).toBeLessThan(4)
  })

  it('lays out much more compactly in table-name mode', async () => {
    const names = Array.from({ length: 40 }, (_, i) => `t${i}`)
    const links = names
      .slice(1)
      .map((name, i): [string, string] => [names[Math.floor(i / 5)] as string, name])
    // Cards with 8 columns: table-name mode (52 px) is several times shorter than all fields.
    const schema: DbSchema = {
      ...schemaOf(names, links),
      tables: Object.fromEntries(names.map((n) => [n, table(n, 8)])),
    }
    const height = (positions: Map<string, Point>) =>
      Math.max(...[...positions.values()].map((p) => p.y)) -
      Math.min(...[...positions.values()].map((p) => p.y))

    const full = await placeTables(schema, [], 'ALL_FIELDS')
    const compact = await placeTables(schema, [], 'TABLE_NAME')

    expect(height(compact.positions)).toBeLessThan(height(full.positions) / 2)
  })

  it('handles large schemas', async () => {
    const names = Array.from({ length: 120 }, (_, i) => `t${i}`)
    const links = names.slice(1).map((name, i): [string, string] => [names[i] as string, name])
    const schema = schemaOf(names, links)
    const { positions } = await placeTables(schema, [])

    expect(positions.size).toBe(120)
    expect(overlaps(schema, positions)).toBe(false)
  })
})
