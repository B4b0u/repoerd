import type { TableGroup } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import {
  validateAssignments,
  validateTableGroup,
  validateTableGroupConfig,
} from '../../src/domain/table-groups.js'

const group = (over: Partial<TableGroup> = {}): TableGroup => ({
  id: 'billing',
  name: 'Billing',
  color: '#aabbcc',
  origins: [],
  ...over,
})

describe('validateTableGroup', () => {
  it('trims the name and lower-cases the colour', () => {
    expect(validateTableGroup(group({ name: '  Billing ', color: '#ABCDEF' }))).toEqual({
      ok: true,
      value: group({ name: 'Billing', color: '#abcdef' }),
    })
  })

  it('refuses an empty name, one of 81 characters and a name of blanks', () => {
    expect(validateTableGroup(group({ name: '' })).ok).toBe(false)
    expect(validateTableGroup(group({ name: '   ' })).ok).toBe(false)
    expect(validateTableGroup(group({ name: 'a'.repeat(81) })).ok).toBe(false)
    expect(validateTableGroup(group({ name: 'a'.repeat(80) })).ok).toBe(true)
  })

  it('refuses a colour that is not #rrggbb', () => {
    for (const color of ['red', '#abc', '#abcdeg', 'abcdef', '#aabbccdd']) {
      expect(validateTableGroup(group({ color })).ok).toBe(false)
    }
  })

  it('refuses ids outside [A-Za-z0-9_-]{1,64}', () => {
    for (const id of ['a b', '', 'a/b', 'x'.repeat(65)]) {
      expect(validateTableGroup(group({ id })).ok).toBe(false)
    }
    expect(validateTableGroup(group({ id: 'Ab_-9'.repeat(12) })).ok).toBe(true)
  })

  it('limits origins to 50, of at most 512 characters', () => {
    const file = (i: number) => ({ kind: 'file' as const, path: `f${i}.ts` })
    expect(
      validateTableGroup(group({ origins: Array.from({ length: 50 }, (_, i) => file(i)) })).ok,
    ).toBe(true)
    expect(
      validateTableGroup(group({ origins: Array.from({ length: 51 }, (_, i) => file(i)) })).ok,
    ).toBe(false)
    expect(
      validateTableGroup(group({ origins: [{ kind: 'folder', path: 'a'.repeat(513) }] })).ok,
    ).toBe(false)
    expect(
      validateTableGroup(group({ origins: [{ kind: 'pgSchema', name: 'a'.repeat(513) }] })).ok,
    ).toBe(false)
    expect(validateTableGroup(group({ origins: [{ kind: 'file', path: '' }] })).ok).toBe(false)
  })
})

describe('validateAssignments', () => {
  it('accepts group ids and null, refuses bad table names, ids and counts', () => {
    expect(validateAssignments({ users: 'billing', posts: null }).ok).toBe(true)
    expect(validateAssignments({ '': 'billing' }).ok).toBe(false)
    expect(validateAssignments({ ['t'.repeat(257)]: 'billing' }).ok).toBe(false)
    expect(validateAssignments({ users: 'a b' }).ok).toBe(false)
    const many = Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`t${i}`, null]))
    expect(validateAssignments(many).ok).toBe(false)
  })
})

describe('validateTableGroupConfig', () => {
  it('refuses 101 groups and duplicated ids', () => {
    const groups = Array.from({ length: 101 }, (_, i) => group({ id: `g${i}` }))
    expect(validateTableGroupConfig({ groups, assignments: {} }).ok).toBe(false)
    expect(validateTableGroupConfig({ groups: groups.slice(0, 100), assignments: {} }).ok).toBe(
      true,
    )
    expect(
      validateTableGroupConfig({ groups: [group(), group({ name: 'Other' })], assignments: {} }).ok,
    ).toBe(false)
  })

  it('refuses a placement to a group absent from the config', () => {
    expect(
      validateTableGroupConfig({ groups: [group()], assignments: { users: 'ghost' } }).ok,
    ).toBe(false)
    expect(
      validateTableGroupConfig({ groups: [group()], assignments: { users: 'billing', p: null } })
        .ok,
    ).toBe(true)
  })

  it('normalises every group', () => {
    const result = validateTableGroupConfig({
      groups: [group({ name: ' B ', color: '#AABBCC' })],
      assignments: {},
    })
    expect(result).toEqual({
      ok: true,
      value: { groups: [group({ name: 'B', color: '#aabbcc' })], assignments: {} },
    })
  })
})
