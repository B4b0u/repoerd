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
})
