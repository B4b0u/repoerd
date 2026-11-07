import type { TableGroupsResponse } from '@repoerd/contracts'
import { type DbSchema, proposeGroups, type Table } from '@repoerd/model'
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
    expect(view).toMatchObject({ proposed: false, groups: [], canEdit: false, loading: false })
    expect([...view.membership.entries()]).toEqual([
      ['user', null],
      ['post', null],
    ])
  })

  it('tells a pending response from a failed one', () => {
    expect(buildGroupView(twoFiles, undefined, { loading: true })).toMatchObject({
      groups: [],
      loading: true,
    })
    const response: TableGroupsResponse = {
      configured: false,
      groups: [],
      assignments: {},
      canEdit: true,
    }
    expect(buildGroupView(twoFiles, response).loading).toBe(false)
  })

  it('proposes from the compared branch alone and resolves the union against it', () => {
    // The base branch had a file the compared branch deleted: it must not become a group.
    const after = schemaOf([table('user', 'db/user.ts'), table('post', 'db/post.ts')])
    const union = schemaOf([
      table('legacy', 'db/aaa-legacy.ts'),
      table('user', 'db/user.ts'),
      table('post', 'db/post.ts'),
    ])
    const unconfigured: TableGroupsResponse = {
      configured: false,
      groups: [],
      assignments: {},
      canEdit: true,
    }
    const view = buildGroupView(union, unconfigured, { proposalSchema: after })
    // Same groups, ids and colours as the compared branch shown alone.
    expect(view.groups).toEqual(proposeGroups(after))
    expect(view.groups).toEqual(buildGroupView(after, unconfigured).groups)
    expect(view.membership.get('legacy')).toBeNull()
    expect(view.membership.get('user')).toBe(view.groups.find((g) => g.name === 'user')?.id)
    expect(view.proposed).toBe(true)
  })
})
