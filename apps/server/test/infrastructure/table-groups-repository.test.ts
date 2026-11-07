import type { TableGroup } from '@repoerd/model'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type AppDatabase, openDatabase } from '../../src/infrastructure/persistence/database.js'
import { SqliteTableGroupRepository } from '../../src/infrastructure/persistence/sqlite-table-group-repository.js'

const repo = { id: 7, owner: 'Acme', name: 'Shop' }
const source = 'prisma/schema.prisma'
const group = (id: string, overrides: Partial<TableGroup> = {}): TableGroup => ({
  id,
  name: id.toUpperCase(),
  color: '#112233',
  origins: [{ kind: 'folder', path: 'src/billing' }],
  ...overrides,
})

let db: AppDatabase
let close: () => void
let groups: SqliteTableGroupRepository

beforeEach(() => {
  ;({ db, close } = openDatabase(':memory:'))
  groups = new SqliteTableGroupRepository(db)
})
afterEach(() => close())

describe('SqliteTableGroupRepository', () => {
  it('reports a source that was never configured', async () => {
    expect(await groups.get(repo, source)).toEqual({
      configured: false,
      config: { groups: [], assignments: {} },
    })
  })

  it('distinguishes a configured empty source', async () => {
    await groups.replace(repo, source, { groups: [], assignments: {} }, 'alice')
    expect(await groups.get(repo, source)).toEqual({
      configured: true,
      config: { groups: [], assignments: {} },
    })
  })

  it('replaces groups and placements, keeping the given order and null placements', async () => {
    await groups.replace(
      repo,
      source,
      { groups: [group('b'), group('a')], assignments: { users: 'a', logs: null } },
      'alice',
    )
    expect((await groups.get(repo, source)).config).toEqual({
      groups: [group('b'), group('a')],
      assignments: { users: 'a', logs: null },
    })
    await groups.replace(
      repo,
      source,
      { groups: [group('c')], assignments: { orders: 'c' } },
      'bob',
    )
    expect(await groups.get(repo, source)).toEqual({
      configured: true,
      config: { groups: [group('c')], assignments: { orders: 'c' } },
    })
  })

  it('lists saved groups in the order they were added; saving an existing id keeps its place', async () => {
    await groups.saveGroup(repo, source, group('b'), 'alice')
    await groups.saveGroup(repo, source, group('a'), 'alice')
    await groups.saveGroup(repo, source, group('b', { name: 'Renamed', origins: [] }), 'bob')
    const stored = await groups.get(repo, source)
    expect(stored.configured).toBe(true)
    expect(stored.config.groups).toEqual([group('b', { name: 'Renamed', origins: [] }), group('a')])
  })

  it('deletes a group with the placements pointing to it', async () => {
    await groups.replace(
      repo,
      source,
      { groups: [group('a'), group('b')], assignments: { users: 'a', orders: 'b', logs: null } },
      'alice',
    )
    await groups.deleteGroup(repo, source, 'a', 'alice')
    expect((await groups.get(repo, source)).config).toEqual({
      groups: [group('b')],
      assignments: { orders: 'b', logs: null },
    })
  })

  it('merges placements, including null, and overwrites existing ones', async () => {
    await groups.replace(
      repo,
      source,
      { groups: [group('a'), group('b')], assignments: { users: 'a' } },
      'alice',
    )
    expect(await groups.place(repo, source, { users: 'b', orders: null }, 'bob')).toEqual({
      ok: true,
    })
    expect((await groups.get(repo, source)).config.assignments).toEqual({
      users: 'b',
      orders: null,
    })
  })

  it('refuses a placement into an unknown group and writes nothing', async () => {
    await groups.saveGroup(repo, source, group('a'), 'alice')
    const result = await groups.place(repo, source, { users: 'a', orders: 'ghost' }, 'alice')
    expect(result).toEqual({ ok: false, error: 'unknown-group' })
    expect((await groups.get(repo, source)).config.assignments).toEqual({})
  })

  it('refuses a 101st group but still updates an existing one', async () => {
    for (let i = 0; i < 100; i++) await groups.saveGroup(repo, source, group(`g${i}`), 'alice')
    expect(await groups.saveGroup(repo, source, group('extra'), 'alice')).toEqual({
      ok: false,
      error: 'too-many-groups',
    })
    expect(await groups.saveGroup(repo, source, group('g3', { name: 'New' }), 'alice')).toEqual({
      ok: true,
    })
    expect((await groups.get(repo, source)).config.groups).toHaveLength(100)
  })

  it('refuses placements past 5,000 distinct tables and writes nothing', async () => {
    await groups.saveGroup(repo, source, group('a'), 'alice')
    const tables = (from: number, to: number) =>
      Object.fromEntries(Array.from({ length: to - from }, (_, i) => [`t${from + i}`, 'a']))
    expect(await groups.place(repo, source, tables(0, 5000), 'alice')).toEqual({ ok: true })
    // Existing tables do not count twice; one new table crosses the cap.
    expect(await groups.place(repo, source, tables(0, 10), 'alice')).toEqual({ ok: true })
    expect(await groups.place(repo, source, { ...tables(0, 2), extra: 'a' }, 'alice')).toEqual({
      ok: false,
      error: 'too-many-assignments',
    })
    expect(Object.keys((await groups.get(repo, source)).config.assignments)).toHaveLength(5000)
  })

  it('stays "never configured" when a delete or a placement writes nothing', async () => {
    await groups.deleteGroup(repo, source, 'ghost', 'alice')
    expect((await groups.get(repo, source)).configured).toBe(false)
    expect(await groups.place(repo, source, {}, 'alice')).toEqual({ ok: true })
    expect((await groups.get(repo, source)).configured).toBe(false)
  })

  it('keeps the sources of a repository, and repositories, independent', async () => {
    await groups.saveGroup(repo, source, group('a'), 'alice')
    await groups.place(repo, source, { users: 'a' }, 'alice')
    expect((await groups.get(repo, 'drizzle/schema.ts')).configured).toBe(false)
    expect((await groups.get({ ...repo, id: 8 }, source)).configured).toBe(false)
    await groups.saveGroup(repo, 'drizzle/schema.ts', group('z'), 'alice')
    await groups.deleteGroup(repo, 'drizzle/schema.ts', 'z', 'alice')
    expect((await groups.get(repo, source)).config).toEqual({
      groups: [group('a')],
      assignments: { users: 'a' },
    })
  })

  it('is keyed by the GitHub id: a rename of the repository keeps its groups', async () => {
    await groups.saveGroup(repo, source, group('a'), 'alice')
    const renamed = { ...repo, owner: 'New', name: 'Name' }
    expect((await groups.get(renamed, source)).config.groups).toEqual([group('a')])
  })

  it('clears a placement so the table follows its origin again', async () => {
    await groups.saveGroup(repo, source, group('a'), 'alice')
    await groups.place(repo, source, { users: 'a', logs: null, orders: 'a' }, 'alice')
    expect(await groups.place(repo, source, {}, 'alice', ['users', 'logs', 'ghost'])).toEqual({
      ok: true,
    })
    expect((await groups.get(repo, source)).config.assignments).toEqual({ orders: 'a' })
  })

  it('mixes clear and place in one call', async () => {
    await groups.saveGroup(repo, source, group('a'), 'alice')
    await groups.place(repo, source, { users: 'a' }, 'alice')
    await groups.place(repo, source, { posts: 'a' }, 'alice', ['users'])
    expect((await groups.get(repo, source)).config.assignments).toEqual({ posts: 'a' })
  })

  it('counts removals in the 5,000 placements cap', async () => {
    await groups.saveGroup(repo, source, group('a'), 'alice')
    const tables = (from: number, to: number) =>
      Object.fromEntries(Array.from({ length: to - from }, (_, i) => [`t${from + i}`, 'a']))
    await groups.place(repo, source, tables(0, 5000), 'alice')
    expect(await groups.place(repo, source, { extra: 'a' }, 'alice', ['t0'])).toEqual({ ok: true })
    expect(await groups.place(repo, source, { more: 'a' }, 'alice', ['ghost'])).toEqual({
      ok: false,
      error: 'too-many-assignments',
    })
    expect(Object.keys((await groups.get(repo, source)).config.assignments)).toHaveLength(5000)
  })

  it('writes nothing when place and clear are both empty', async () => {
    expect(await groups.place(repo, source, {}, 'alice', [])).toEqual({ ok: true })
    expect((await groups.get(repo, source)).configured).toBe(false)
  })

  it('moves an origin to the saved group: other groups lose it, nothing else changes', async () => {
    const file = { kind: 'file' as const, path: 'a.ts' }
    const folder = { kind: 'folder' as const, path: 'src' }
    await groups.saveGroup(repo, source, group('a', { origins: [file, folder] }), 'alice')
    await groups.saveGroup(repo, source, group('c', { name: 'Keep', origins: [folder] }), 'alice')
    // 'c' took the folder from 'a'.
    await groups.saveGroup(repo, source, group('b', { origins: [file] }), 'alice')
    const stored = (await groups.get(repo, source)).config.groups
    expect(stored).toEqual([
      group('a', { origins: [] }),
      group('c', { name: 'Keep', origins: [folder] }),
      group('b', { origins: [file] }),
    ])
  })

  it('caps the configured sources of a repository at 50', async () => {
    for (let i = 0; i < 50; i++) await groups.saveGroup(repo, `s${i}`, group('a'), 'alice')
    expect(await groups.saveGroup(repo, 'extra', group('a'), 'alice')).toEqual({
      ok: false,
      error: 'too-many-sources',
    })
    expect(await groups.place(repo, 'extra', { t: null }, 'alice')).toEqual({
      ok: false,
      error: 'too-many-sources',
    })
    expect(await groups.replace(repo, 'extra', { groups: [], assignments: {} }, 'alice')).toEqual({
      ok: false,
      error: 'too-many-sources',
    })
    expect((await groups.get(repo, 'extra')).configured).toBe(false)
    // Existing sources keep working, and another repository has its own budget.
    expect(await groups.saveGroup(repo, 's3', group('z'), 'alice')).toEqual({ ok: true })
    expect(await groups.saveGroup({ ...repo, id: 8 }, 'extra', group('a'), 'alice')).toEqual({
      ok: true,
    })
  })
})
