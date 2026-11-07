import type { TableGroupsResponse } from '@repoerd/contracts'
import type { DbSchema, Table } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import { buildGroupView } from '../../src/features/diagram/groups/group-view'

const table = (name: string, file?: string): Table => ({
  name,
  schema: null,
  comment: null,
  columns: [],
  indexes: [],
  constraints: [],
  ...(file === undefined ? {} : { file }),
})

const schemaOf = (tables: Table[]): DbSchema => ({
  tables: Object.fromEntries(tables.map((t) => [t.name, t])),
  enums: {},
  relationships: [],
})

const twoFiles = schemaOf([table('user', 'db/user.ts'), table('post', 'db/post.ts')])

describe('buildGroupView', () => {
  it('proposes one group per file when nothing is saved', () => {
    const view = buildGroupView(twoFiles, {
      configured: false,
      groups: [],
      assignments: {},
      canEdit: true,
    })
    expect(view.proposed).toBe(true)
    expect(view.groups.map((g) => g.name)).toEqual(['post', 'user'])
    expect(view.membership.get('user')).toBe(view.groups[1]?.id)
    expect(view.canEdit).toBe(true)
  })

  it('is not proposed when the schema shows no split', () => {
    const view = buildGroupView(schemaOf([table('a', 'db/s.ts'), table('b', 'db/s.ts')]), {
      configured: false,
      groups: [],
      assignments: {},
      canEdit: false,
    })
    expect(view.proposed).toBe(false)
    expect(view.groups).toEqual([])
    expect([...view.membership.values()]).toEqual([null, null])
  })

  it('keeps an empty saved configuration empty', () => {
    const view = buildGroupView(twoFiles, {
      configured: true,
      groups: [],
      assignments: {},
      canEdit: false,
    })
    expect(view.proposed).toBe(false)
    expect(view.groups).toEqual([])
  })

  it('follows manual placements of a saved configuration', () => {
    const response: TableGroupsResponse = {
      configured: true,
      groups: [{ id: 'g1', name: 'Core', color: '#123456', origins: [] }],
      assignments: { user: 'g1', post: null },
      canEdit: true,
    }
    const view = buildGroupView(twoFiles, response)
    expect(view.proposed).toBe(false)
    expect(view.membership.get('user')).toBe('g1')
    expect(view.membership.get('post')).toBeNull()
  })

  it('shows no group while the response is missing', () => {
    const view = buildGroupView(twoFiles, undefined)
    expect(view).toMatchObject({ proposed: false, groups: [], canEdit: false })
    expect([...view.membership.entries()]).toEqual([
      ['user', null],
      ['post', null],
    ])
  })
})
