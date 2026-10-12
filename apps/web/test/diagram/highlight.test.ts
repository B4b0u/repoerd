import type { DbSchema, Table } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import {
  createHighlighter,
  highlightFlow,
  neighborsOf,
} from '../../src/features/diagram/model/highlight'
import { buildFlow } from '../../src/features/diagram/model/to-flow'

const table = (name: string, columns: string[]): Table => ({
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
  constraints: [],
})

const link = (parent: string, child: string, column: string) => ({
  name: `${child}_${column}_fk`,
  from: { table: parent, columns: ['id'] },
  to: { table: child, columns: [column] },
  cardinality: 'ONE_TO_MANY' as const,
})

const schema: DbSchema = {
  tables: {
    users: table('users', ['id']),
    posts: table('posts', ['id', 'author_id']),
    tags: table('tags', ['id']),
    categories: table('categories', ['id', 'parent_id']),
  },
  enums: {},
  relationships: [
    link('users', 'posts', 'author_id'),
    link('categories', 'categories', 'parent_id'),
  ],
}
const flow = buildFlow(schema, new Map())
const none = new Set<string>()
const stateOf = (result: ReturnType<typeof highlightFlow>, id: string) =>
  result.nodes.find((n) => n.id === id)?.data.highlight

describe('neighborsOf', () => {
  it('returns direct neighbours in both directions and never the table itself', () => {
    expect(neighborsOf(flow.edges, 'users')).toEqual(new Set(['posts']))
    expect(neighborsOf(flow.edges, 'posts')).toEqual(new Set(['users']))
    expect(neighborsOf(flow.edges, 'categories')).toEqual(new Set())
  })
})

describe('highlightFlow', () => {
  it('leaves everything neutral without an active or hovered table', () => {
    const result = highlightFlow(flow.nodes, flow.edges, { hidden: none })
    expect(result.nodes.every((n) => n.data.highlight === 'none')).toBe(true)
    expect(result.edges.every((e) => !e.animated && e.className === undefined)).toBe(true)
  })

  it('highlights the active table, its neighbours and their relationships', () => {
    const result = highlightFlow(flow.nodes, flow.edges, { active: 'users', hidden: none })
    expect(stateOf(result, 'users')).toBe('active')
    expect(stateOf(result, 'posts')).toBe('related')
    expect(stateOf(result, 'tags')).toBe('dimmed')
    const usersPosts = result.edges.find((e) => e.source === 'users')
    expect(usersPosts).toMatchObject({
      animated: true,
      className: 'relationship-edge--highlighted',
    })
    expect(result.edges.find((e) => e.source === 'categories')?.className).toBe(
      'relationship-edge--dimmed',
    )
  })

  it('previews the hovered table without animating edges', () => {
    const result = highlightFlow(flow.nodes, flow.edges, {
      active: 'tags',
      hovered: 'posts',
      hidden: none,
    })
    expect(stateOf(result, 'posts')).toBe('active')
    expect(stateOf(result, 'users')).toBe('related')
    expect(result.edges.find((e) => e.source === 'users')?.animated).toBe(false)
  })

  it('highlights a self-referencing table without marking it as its own neighbour', () => {
    const result = highlightFlow(flow.nodes, flow.edges, { active: 'categories', hidden: none })
    expect(stateOf(result, 'categories')).toBe('active')
    expect(result.edges.find((e) => e.source === 'categories')?.className).toBe(
      'relationship-edge--highlighted',
    )
  })

  it('hides hidden tables and their edges, and ignores a hidden or unknown focus', () => {
    const result = highlightFlow(flow.nodes, flow.edges, {
      active: 'users',
      hidden: new Set(['users']),
    })
    expect(result.nodes.find((n) => n.id === 'users')?.hidden).toBe(true)
    expect(result.edges.find((e) => e.source === 'users')?.hidden).toBe(true)
    expect(result.nodes.every((n) => n.data.highlight === 'none')).toBe(true)

    const unknown = highlightFlow(flow.nodes, flow.edges, { active: 'ghost', hidden: none })
    expect(unknown.nodes.every((n) => n.data.highlight === 'none')).toBe(true)
  })

  it('copes with every table hidden', () => {
    const all = new Set(Object.keys(schema.tables))
    const result = highlightFlow(flow.nodes, flow.edges, { hidden: all })
    expect(result.nodes.every((n) => n.hidden)).toBe(true)
    expect(result.edges.every((e) => e.hidden)).toBe(true)
  })
})

describe('createHighlighter', () => {
  it('reuses the derived node and edge objects whose display did not change', () => {
    const highlight = createHighlighter()
    const first = highlight(flow.nodes, flow.edges, { active: 'users', hidden: none })
    const second = highlight(flow.nodes, flow.edges, {
      active: 'users',
      hovered: 'posts',
      hidden: none,
    })
    const node = (result: typeof first, id: string) => result.nodes.find((n) => n.id === id)
    // tags and categories stay dimmed: same objects, so memoised cards do not re-render.
    expect(node(second, 'tags')).toBe(node(first, 'tags'))
    expect(node(second, 'categories')).toBe(node(first, 'categories'))
    expect(node(second, 'posts')).not.toBe(node(first, 'posts'))
    const selfEdge = (result: typeof first) => result.edges.find((e) => e.source === 'categories')
    expect(selfEdge(second)).toBe(selfEdge(first))
  })

  it('derives a node again when the flow gives a new object for it (a drag)', () => {
    const highlight = createHighlighter()
    const first = highlight(flow.nodes, flow.edges, { hidden: none })
    const moved = flow.nodes.map((n) => (n.id === 'tags' ? { ...n, position: { x: 5, y: 5 } } : n))
    const second = highlight(moved, flow.edges, { hidden: none })
    expect(second.nodes.find((n) => n.id === 'tags')?.position).toEqual({ x: 5, y: 5 })
    expect(second.nodes.find((n) => n.id === 'users')).toBe(
      first.nodes.find((n) => n.id === 'users'),
    )
  })
})
