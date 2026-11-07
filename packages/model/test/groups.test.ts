import { describe, expect, it } from 'vitest'
import { GROUP_PALETTE, proposalId, proposeGroups, TABLE_GROUP_LIMITS } from '../src/groups.js'
import type { DbSchema, Table } from '../src/schema.js'

const table = (name: string, file?: string, schema: string | null = null): Table => ({
  name,
  schema,
  comment: null,
  columns: [],
  indexes: [],
  constraints: [],
  ...(file === undefined ? {} : { file }),
})

const schemaOf = (...tables: Table[]): DbSchema => ({
  tables: Object.fromEntries(tables.map((t) => [t.name, t])),
  enums: {},
  relationships: [],
})

describe('proposeGroups', () => {
  it('proposes one file group per schema file', () => {
    const groups = proposeGroups(
      schemaOf(
        table('users', 'src/db/schema/users.ts'),
        table('billing', 'src/db/schema/billing.ts'),
        table('tickets', 'src/db/schema/tickets.ts'),
      ),
    )
    expect(groups.map((g) => g.name)).toEqual(['billing', 'tickets', 'users'])
    expect(groups[0]?.origins).toEqual([{ kind: 'file', path: 'src/db/schema/billing.ts' }])
  })

  it('proposes one folder group per domain folder', () => {
    const groups = proposeGroups(
      schemaOf(
        table('invoices', 'src/domains/billing/invoices.ts'),
        table('payments', 'src/domains/billing/payments.ts'),
        table('users', 'src/domains/identity/users.ts'),
      ),
    )
    expect(groups.map((g) => g.name)).toEqual(['billing', 'identity'])
    expect(groups[0]?.origins).toEqual([{ kind: 'folder', path: 'src/domains/billing' }])
    expect(groups[1]?.origins).toEqual([{ kind: 'folder', path: 'src/domains/identity' }])
  })

  it('falls back to files when some file sits directly in the common folder', () => {
    const groups = proposeGroups(
      schemaOf(
        table('a', 'prisma/schema.prisma'),
        table('orders', 'prisma/models/orders.prisma'),
        table('catalog', 'prisma/models/catalog.prisma'),
      ),
    )
    expect(groups.map((g) => g.name)).toEqual(['catalog', 'orders', 'schema'])
    expect(groups.every((g) => g.origins[0]?.kind === 'file')).toBe(true)
  })

  it('falls back to files when all files share a single sub-folder', () => {
    const groups = proposeGroups(schemaOf(table('a', 'x/y/a.ts'), table('b', 'x/y/b.ts')))
    expect(groups.map((g) => g.origins[0]?.kind)).toEqual(['file', 'file'])
  })

  it('handles files at the repo root', () => {
    const groups = proposeGroups(schemaOf(table('a', 'a.ts'), table('b', 'dir/b.ts')))
    expect(groups.map((g) => g.origins[0]?.kind)).toEqual(['file', 'file'])
  })

  it('proposes folder groups from the repo root when every file is in a folder', () => {
    const groups = proposeGroups(schemaOf(table('a', 'one/a.ts'), table('b', 'two/b.ts')))
    expect(groups.map((g) => g.origins[0])).toEqual([
      { kind: 'folder', path: 'one' },
      { kind: 'folder', path: 'two' },
    ])
  })

  it('proposes pgSchema groups when a single file declares several schemas', () => {
    const groups = proposeGroups(
      schemaOf(
        table('billing.invoices', 'schema.prisma', 'billing'),
        table('users', 'schema.prisma', null),
      ),
    )
    expect(groups.map((g) => g.name)).toEqual(['billing', 'public'])
    expect(groups[0]?.origins).toEqual([{ kind: 'pgSchema', name: 'billing' }])
  })

  it('proposes nothing for one file and one schema, or without files', () => {
    expect(proposeGroups(schemaOf(table('a', 's.ts'), table('b', 's.ts')))).toEqual([])
    expect(proposeGroups(schemaOf(table('a'), table('b', undefined, 'x')))).toEqual([])
  })

  it('names a file group up to its first dot', () => {
    const groups = proposeGroups(
      schemaOf(table('a', 'd/drizzle-entity-001.schema.ts'), table('b', 'd/other.ts')),
    )
    expect(groups.map((g) => g.name)).toEqual(['drizzle-entity-001', 'other'])
  })

  it('cycles the palette past 12 groups', () => {
    const tables = Array.from({ length: 13 }, (_, i) =>
      table(`t${i}`, `d/${String(i).padStart(2, '0')}.ts`),
    )
    const groups = proposeGroups(schemaOf(...tables))
    expect(groups).toHaveLength(13)
    expect(groups[0]?.color).toBe(GROUP_PALETTE[0])
    expect(groups[12]?.color).toBe(GROUP_PALETTE[0])
    expect(groups[1]?.color).toBe(GROUP_PALETTE[1])
  })

  it('uses stable ids that match the id pattern', () => {
    const groups = proposeGroups(schemaOf(table('a', 'd/a.ts'), table('b', 'd/b.ts')))
    expect(groups[0]?.id).toBe(proposalId({ kind: 'file', path: 'd/a.ts' }))
  })
})

describe('proposalId', () => {
  it('is stable and well-formed', () => {
    const id = proposalId({ kind: 'file', path: 'a.ts' })
    expect(id).toBe(proposalId({ kind: 'file', path: 'a.ts' }))
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    expect(id).toMatch(/^p[0-9a-f]{8}$/)
    expect(id).not.toBe(proposalId({ kind: 'folder', path: 'a.ts' }))
  })
})

describe('constants', () => {
  it('exposes the limits and a 12 colour palette', () => {
    expect(TABLE_GROUP_LIMITS.groups).toBe(100)
    expect(GROUP_PALETTE).toHaveLength(12)
    expect(new Set(GROUP_PALETTE).size).toBe(12)
    for (const c of GROUP_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/)
  })
})
