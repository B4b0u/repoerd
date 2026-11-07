import type { DbSchema, Table } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import { type Box, groupFrames } from '../../src/features/diagram/groups/group-frames'
import { layoutTables } from '../../src/features/diagram/layout/auto-layout'
import { placeTables } from '../../src/features/diagram/layout/place-tables'
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
    tables: Object.fromEntries(names.map((n, i) => [n, table(n, 2 + (i % 4))])),
    enums: {},
    relationships: links.map(([parent, child]) => ({
      name: `${child}_${parent}_fk`,
      from: { table: parent, columns: ['c0'] },
      to: { table: child, columns: ['c1'] },
      cardinality: 'ONE_TO_MANY' as const,
    })),
  }
}

// Three groups of three tables, two ungrouped tables; links inside and across groups.
const NAMES = ['user', 'session', 'account', 'post', 'comment', 'tag', 'invoice', 'line', 'tax']
const UNGROUPED = ['audit', 'setting']
const SCHEMA = schemaOf(
  [...NAMES, ...UNGROUPED],
  [
    ['user', 'session'],
    ['user', 'account'],
    ['user', 'post'],
    ['post', 'comment'],
    ['user', 'comment'],
    ['post', 'tag'],
    ['account', 'invoice'],
    ['invoice', 'line'],
    ['tax', 'line'],
    ['user', 'audit'],
  ],
)
// A group id equal to a table name must not confuse the layout.
const MEMBERSHIP: ReadonlyMap<string, string | null> = new Map([
  ['user', 'auth'],
  ['session', 'auth'],
  ['account', 'auth'],
  ['post', 'content'],
  ['comment', 'content'],
  ['tag', 'content'],
  ['invoice', 'tax'],
  ['line', 'tax'],
  ['tax', 'tax'],
  ['audit', null],
  ['setting', null],
])

function boxesOf(schema: DbSchema, positions: ReadonlyMap<string, Point>): Box[] {
  return [...positions].map(([id, p]) => ({ id, ...p, ...tableSize(schema.tables[id] as Table) }))
}

function framesOf(
  schema: DbSchema,
  positions: ReadonlyMap<string, Point>,
  membership: ReadonlyMap<string, string | null>,
) {
  const clusters = new Map<string, string[]>()
  for (const name of positions.keys()) {
    const groupId = membership.get(name)
    if (groupId) clusters.set(groupId, [...(clusters.get(groupId) ?? []), name])
  }
  return groupFrames(boxesOf(schema, positions), clusters)
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}
const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

function expectSeparatedGroups(
  schema: DbSchema,
  positions: ReadonlyMap<string, Point>,
  membership: ReadonlyMap<string, string | null>,
) {
  const frames = framesOf(schema, positions, membership)
  const boxes = boxesOf(schema, positions)
  for (const [i, a] of frames.entries()) {
    for (const b of frames.slice(i + 1)) {
      expect(intersects(a, b), `${a.groupId} / ${b.groupId}`).toBe(false)
    }
    // No table outside the group lies in its frame (other groups' tables, ungrouped tables).
    for (const box of boxes) {
      if (membership.get(box.id) === a.groupId) continue
      expect(intersects(a, box), `${box.id} in ${a.groupId}`).toBe(false)
    }
  }
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) expect(intersects(a, b), `${a.id} / ${b.id}`).toBe(false)
  }
}

describe('layoutTables by group', () => {
  it('keeps each group together, apart from the other groups and the ungrouped tables', async () => {
    const positions = await layoutTables(
      SCHEMA,
      Object.keys(SCHEMA.tables),
      'ALL_FIELDS',
      MEMBERSHIP,
    )

    expect([...positions.keys()].sort()).toEqual(Object.keys(SCHEMA.tables).sort())
    expect(framesOf(SCHEMA, positions, MEMBERSHIP)).toHaveLength(3)
    expectSeparatedGroups(SCHEMA, positions, MEMBERSHIP)
  })

  it('lays out exactly as before without groups', async () => {
    const names = Object.keys(SCHEMA.tables)
    const before = await layoutTables(SCHEMA, names, 'ALL_FIELDS')
    const ungrouped = new Map(names.map((name): [string, string | null] => [name, null]))

    expect(await layoutTables(SCHEMA, names, 'ALL_FIELDS', ungrouped)).toEqual(before)
    expect(await layoutTables(SCHEMA, names, 'ALL_FIELDS', new Map())).toEqual(before)
    expect(await layoutTables(SCHEMA, names, 'ALL_FIELDS', undefined)).toEqual(before)
  })

  it('lays out only the requested tables, whatever the membership lists', async () => {
    const names = ['user', 'session', 'post', 'audit']
    const positions = await layoutTables(SCHEMA, names, 'TABLE_NAME', MEMBERSHIP)

    expect([...positions.keys()].sort()).toEqual([...names].sort())
  })

  it('keeps groups apart in a long chain that needs wrapping', async () => {
    const names = Array.from({ length: 100 }, (_, i) => `t${i}`)
    const links = names.slice(1).map((name, i): [string, string] => [names[i] as string, name])
    const schema = schemaOf(names, links)
    const membership = new Map(
      names.map((name, i): [string, string | null] => [
        name,
        i % 10 === 9 ? null : `g${Math.floor(i / 10)}`,
      ]),
    )
    const positions = await layoutTables(schema, names, 'ALL_FIELDS', membership)

    expect(positions.size).toBe(100)
    expectSeparatedGroups(schema, positions, membership)
    const xs = [...positions.values()].map((p) => p.x)
    const ys = [...positions.values()].map((p) => p.y)
    const width = Math.max(...xs) - Math.min(...xs)
    const height = Math.max(...ys) - Math.min(...ys)
    expect(width / Math.max(height, 1)).toBeLessThan(4)
  })
})

describe('placeTables by group', () => {
  it('places a first visit group by group, on whole canvas units', async () => {
    const { positions, added } = await placeTables(SCHEMA, [], 'ALL_FIELDS', MEMBERSHIP)

    expect(added).toHaveLength(Object.keys(SCHEMA.tables).length)
    for (const p of positions.values()) {
      expect(Number.isInteger(p.x)).toBe(true)
      expect(Number.isInteger(p.y)).toBe(true)
    }
    expectSeparatedGroups(SCHEMA, positions, MEMBERSHIP)
  })
})
