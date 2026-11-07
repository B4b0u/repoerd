import type { TableGroupsResponse } from '@repoerd/contracts'
import { type DbSchema, GROUP_PALETTE, type Table, type TableGroup } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import {
  applyEdits,
  inverseOf,
  newGroup,
  placeEdits,
  undoEdits,
} from '../../src/features/diagram/groups/edits'

const table = (name: string, file?: string): Table => ({
  name,
  schema: null,
  comment: null,
  columns: [],
  indexes: [],
  constraints: [],
  ...(file === undefined ? {} : { file }),
})

const schema: DbSchema = {
  tables: Object.fromEntries(
    [
      table('user', 'db/auth.ts'),
      table('session', 'db/auth.ts'),
      table('post', 'db/blog.ts'),
      table('comment', 'db/blog.ts'),
      table('tag', 'db/tags.ts'),
    ].map((t) => [t.name, t]),
  ),
  enums: {},
  relationships: [],
}

const auth: TableGroup = {
  id: 'auth',
  name: 'auth',
  color: '#e6194b',
  origins: [{ kind: 'file', path: 'db/auth.ts' }],
}
const blog: TableGroup = {
  id: 'blog',
  name: 'blog',
  color: '#f58231',
  origins: [
    { kind: 'file', path: 'db/blog.ts' },
    { kind: 'file', path: 'db/tags.ts' },
  ],
}

const current: TableGroupsResponse = {
  configured: true,
  groups: [auth, blog],
  assignments: { comment: 'auth' },
  canEdit: true,
}

describe('placeEdits', () => {
  it('places the tables in the group', () => {
    expect(placeEdits(schema, current, ['user'], 'blog')).toEqual([
      { kind: 'place', assignments: { user: 'blog' }, clear: [] },
    ])
  })

  it('makes the group adopt a file all of whose tables it now holds, and nothing else', () => {
    expect(placeEdits(schema, current, ['post'], 'auth')).toEqual([
      { kind: 'place', assignments: { post: 'auth' }, clear: [] },
      {
        kind: 'saveGroup',
        group: {
          ...auth,
          origins: [
            { kind: 'file', path: 'db/auth.ts' },
            { kind: 'file', path: 'db/blog.ts' },
          ],
        },
      },
    ])
  })

  it('sends a table back to its file with clear', () => {
    expect(placeEdits(schema, current, ['comment'], 'origin')).toEqual([
      { kind: 'place', assignments: {}, clear: ['comment'] },
    ])
  })

  it('places the tables explicitly out of any group with null', () => {
    expect(placeEdits(schema, current, ['comment', 'tag'], null)).toEqual([
      { kind: 'place', assignments: { comment: null, tag: null }, clear: [] },
    ])
  })

  it('does not adopt for a file another group already completes on its own', () => {
    // tag (db/tags.ts) is placed by hand in auth already, but the gesture does not touch it.
    const before = { ...current, assignments: { tag: 'auth' } }
    expect(placeEdits(schema, before, ['user'], 'blog')).toEqual([
      { kind: 'place', assignments: { user: 'blog' }, clear: [] },
    ])
  })
})

describe('inverseOf', () => {
  it('restores a deleted group, then its placements', () => {
    const before = { ...current, assignments: { comment: 'auth', post: 'auth', tag: 'blog' } }
    expect(inverseOf([{ kind: 'deleteGroup', groupId: 'auth' }], before)).toEqual([
      { kind: 'saveGroup', group: auth },
      { kind: 'place', assignments: { comment: 'auth', post: 'auth' }, clear: [] },
    ])
  })

  it('gives every placed table its previous placement, or its file back', () => {
    const edits = [
      { kind: 'place' as const, assignments: { comment: null, user: 'blog' }, clear: [] },
    ]
    expect(inverseOf(edits, current)).toEqual([
      { kind: 'place', assignments: { comment: 'auth' }, clear: ['user'] },
    ])
  })

  it('places again the tables a gesture sent back to their file', () => {
    const edits = [{ kind: 'place' as const, assignments: {}, clear: ['comment'] }]
    expect(inverseOf(edits, current)).toEqual([
      { kind: 'place', assignments: { comment: 'auth' }, clear: [] },
    ])
  })

  it('undoes an adoption: both groups get their origins back, then the placement', () => {
    const edits = placeEdits(schema, current, ['post'], 'auth')
    expect(inverseOf(edits, current)).toEqual([
      { kind: 'saveGroup', group: auth },
      { kind: 'saveGroup', group: blog },
      { kind: 'place', assignments: {}, clear: ['post'] },
    ])
  })

  it('deletes a group the gesture created', () => {
    const created = { id: 'new1', name: 'new', color: '#1e90ff', origins: [] }
    const edits = [
      { kind: 'saveGroup' as const, group: created },
      { kind: 'place' as const, assignments: { tag: 'new1' }, clear: [] },
    ]
    expect(inverseOf(edits, current)).toEqual([
      { kind: 'place', assignments: {}, clear: ['tag'] },
      { kind: 'deleteGroup', groupId: 'new1' },
    ])
  })

  it('restores a renamed group', () => {
    const edits = [{ kind: 'saveGroup' as const, group: { ...auth, name: 'Accounts' } }]
    expect(inverseOf(edits, current)).toEqual([{ kind: 'saveGroup', group: auth }])
  })

  it('replaces everything back after a replacement', () => {
    const edits = [{ kind: 'saveAll' as const, groups: [], assignments: {} }]
    expect(inverseOf(edits, current)).toEqual([
      { kind: 'saveAll', groups: current.groups, assignments: current.assignments },
    ])
  })
})

describe('undoEdits', () => {
  it('does not bring back a group someone deleted after the gesture', () => {
    const edits = placeEdits(schema, current, ['post'], 'auth')
    const later = { ...current, groups: [blog] }
    expect(undoEdits(edits, current, later)).toEqual([
      { kind: 'saveGroup', group: blog },
      { kind: 'place', assignments: {}, clear: ['post'] },
    ])
  })

  it('brings back the group the gesture deleted', () => {
    const edits = [{ kind: 'deleteGroup' as const, groupId: 'auth' }]
    const later = { ...current, groups: [blog], assignments: {} }
    expect(undoEdits(edits, current, later)).toEqual([
      { kind: 'saveGroup', group: auth },
      { kind: 'place', assignments: { comment: 'auth' }, clear: [] },
    ])
  })
})

describe('applyEdits', () => {
  it('drops the placements of a deleted group, as the server does', () => {
    const state = { ...current, assignments: { comment: 'auth', tag: 'blog' } }
    expect(applyEdits(state, [{ kind: 'deleteGroup', groupId: 'auth' }])).toEqual({
      ...state,
      groups: [blog],
      assignments: { tag: 'blog' },
    })
  })

  it('takes the origins of a saved group from the other groups, keeping its place', () => {
    const saved = {
      ...auth,
      name: 'Accounts',
      origins: [...auth.origins, { kind: 'file' as const, path: 'db/blog.ts' }],
    }
    const next = applyEdits(current, [{ kind: 'saveGroup', group: saved }])
    expect(next.groups).toEqual([
      saved,
      { ...blog, origins: [{ kind: 'file', path: 'db/tags.ts' }] },
    ])
  })

  it('adds a new group last', () => {
    const created = { id: 'new1', name: 'new', color: '#1e90ff', origins: [] }
    const next = applyEdits(current, [{ kind: 'saveGroup', group: created }])
    expect(next.groups.map((g) => g.id)).toEqual(['auth', 'blog', 'new1'])
  })

  it('places and clears tables', () => {
    const next = applyEdits(current, [
      { kind: 'place', assignments: { user: 'blog', tag: null }, clear: ['comment'] },
    ])
    expect(next.assignments).toEqual({ user: 'blog', tag: null })
  })

  it('replaces everything, and marks a never configured source as configured', () => {
    const never = { configured: false, groups: [], assignments: {}, canEdit: true }
    expect(applyEdits(never, [{ kind: 'saveAll', groups: [auth], assignments: {} }])).toEqual({
      configured: true,
      groups: [auth],
      assignments: {},
      canEdit: true,
    })
  })
})

describe('newGroup', () => {
  it('has a valid random id, no origin, and the first unused colour', () => {
    const group = newGroup([auth, blog], 'Billing')
    expect(group.id).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(group.id).not.toBe(newGroup([], 'x').id)
    expect(group).toMatchObject({ name: 'Billing', color: GROUP_PALETTE[2], origins: [] })
  })

  it('cycles through the palette once every colour is used', () => {
    const all = GROUP_PALETTE.map((color, i) => ({ ...auth, id: `g${i}`, color }))
    expect(newGroup(all, 'x').color).toBe(GROUP_PALETTE[0])
    expect(newGroup([...all, { ...auth, id: 'extra' }], 'x').color).toBe(GROUP_PALETTE[1])
  })
})
