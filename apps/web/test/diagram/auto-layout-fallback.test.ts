import type { DbSchema, Table } from '@repoerd/model'
import type { ElkNode } from 'elkjs/lib/elk-api'
import { describe, expect, it, vi } from 'vitest'

const elk = vi.hoisted(() => ({ compoundAttempts: 0 }))

// An ELK that fails on graphs with compound nodes (the grouped layouts) and lays out the others.
vi.mock('elkjs/lib/elk.bundled.js', async (importOriginal) => {
  const actual = await importOriginal<{
    default: new () => { layout(graph: ElkNode): Promise<ElkNode> }
  }>()
  class FailingOnGroups {
    private readonly elk = new actual.default()
    layout(graph: ElkNode): Promise<ElkNode> {
      if (graph.children?.some((child) => (child.children?.length ?? 0) > 0)) {
        elk.compoundAttempts += 1
        return Promise.reject(new Error('ELK failed on the hierarchy'))
      }
      return this.elk.layout(graph)
    }
  }
  return { default: FailingOnGroups }
})

const table = (name: string): Table => ({
  name,
  schema: null,
  comment: null,
  columns: [],
  indexes: [],
  constraints: [],
})
const SCHEMA: DbSchema = {
  tables: { users: table('users'), posts: table('posts'), tags: table('tags') },
  enums: {},
  relationships: [
    {
      name: 'posts_users_fk',
      from: { table: 'users', columns: ['id'] },
      to: { table: 'posts', columns: ['user_id'] },
      cardinality: 'ONE_TO_MANY',
    },
  ],
}
const NAMES = Object.keys(SCHEMA.tables)

describe('a grouped layout ELK cannot compute', () => {
  it('falls back to the ungrouped layout, so that the diagram still shows', async () => {
    const { layoutTables } = await import('../../src/features/diagram/layout/auto-layout')
    const membership = new Map<string, string | null>([
      ['users', 'core'],
      ['posts', 'core'],
      ['tags', null],
    ])

    const grouped = await layoutTables(SCHEMA, NAMES, 'ALL_FIELDS', membership)

    expect(elk.compoundAttempts).toBe(1)
    expect(grouped).toEqual(await layoutTables(SCHEMA, NAMES, 'ALL_FIELDS'))
    expect([...grouped.keys()].sort()).toEqual([...NAMES].sort())
  })
})
