import { describe, expect, it } from 'vitest'
import {
  adoptOrigins,
  GROUP_PALETTE,
  proposalId,
  proposeGroups,
  resolveTableGroups,
  TABLE_GROUP_LIMITS,
  type TableGroup,
  type TableGroupConfig,
  withoutGroup,
} from '../src/groups.js'
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
    expect(TABLE_GROUP_LIMITS.origins).toBe(1000)
    expect(TABLE_GROUP_LIMITS.sources).toBe(50)
    expect(GROUP_PALETTE).toHaveLength(12)
    expect(new Set(GROUP_PALETTE).size).toBe(12)
    for (const c of GROUP_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/)
  })
})

const group = (id: string, ...origins: TableGroup['origins']): TableGroup => ({
  id,
  name: id,
  color: '#e6194b',
  origins,
})
const cfg = (
  groups: TableGroup[],
  assignments: Record<string, string | null> = {},
): TableGroupConfig => ({ groups, assignments })

describe('resolveTableGroups', () => {
  it('prefers a manual placement over the origin, and null means ungrouped', () => {
    const schema = schemaOf(table('a', 'src/a.ts'), table('b', 'src/b.ts'), table('c', 'src/c.ts'))
    const config = cfg([group('g1', { kind: 'folder', path: 'src' }), group('g2')], {
      a: 'g2',
      b: null,
    })
    const resolved = resolveTableGroups(schema, config)
    expect(resolved.get('a')).toBe('g2')
    expect(resolved.get('b')).toBeNull()
    expect(resolved.get('c')).toBe('g1')
  })

  it('prefers file over folder, and the longest folder over a shorter one', () => {
    const schema = schemaOf(
      table('refunds', 'src/domains/billing/refunds.ts'),
      table('invoices', 'src/domains/billing/invoices.ts'),
      table('users', 'src/domains/identity/users.ts'),
    )
    const config = cfg([
      group('wide', { kind: 'folder', path: 'src' }),
      group('folder', { kind: 'folder', path: 'src/domains/billing' }),
      group('file', { kind: 'file', path: 'src/domains/billing/refunds.ts' }),
    ])
    const resolved = resolveTableGroups(schema, config)
    expect(resolved.get('refunds')).toBe('file')
    expect(resolved.get('invoices')).toBe('folder')
    expect(resolved.get('users')).toBe('wide')
  })

  it('matches folders on whole segments', () => {
    const schema = schemaOf(table('a', 'src/billing2/a.ts'))
    const resolved = resolveTableGroups(
      schema,
      cfg([group('g', { kind: 'folder', path: 'src/billing' })]),
    )
    expect(resolved.get('a')).toBeNull()
  })

  it('lets only a pgSchema origin place a table without file', () => {
    const schema = schemaOf(table('a', undefined, 'auth'), table('b'), table('c', 'x/c.ts', 'auth'))
    const config = cfg([
      group('f', { kind: 'folder', path: 'x' }),
      group('auth', { kind: 'pgSchema', name: 'auth' }),
      group('pub', { kind: 'pgSchema', name: 'public' }),
    ])
    const resolved = resolveTableGroups(schema, config)
    expect(resolved.get('a')).toBe('auth')
    expect(resolved.get('b')).toBe('pub')
    expect(resolved.get('c')).toBe('f')
  })

  it('ignores a placement to an unknown group and follows the origin', () => {
    const schema = schemaOf(table('a', 'src/a.ts'))
    const config = cfg([group('g', { kind: 'file', path: 'src/a.ts' })], { a: 'ghost' })
    expect(resolveTableGroups(schema, config).get('a')).toBe('g')
  })

  it('lets the first group win when two claim the same origin', () => {
    const schema = schemaOf(table('a', 'src/a.ts'))
    const o = { kind: 'file', path: 'src/a.ts' } as const
    expect(resolveTableGroups(schema, cfg([group('first', o), group('second', o)])).get('a')).toBe(
      'first',
    )
  })

  it('does not read inherited keys as placements', () => {
    const schema = schemaOf(table('constructor'))
    expect(resolveTableGroups(schema, cfg([])).get('constructor')).toBeNull()
  })
})

describe('adoptOrigins', () => {
  const schema = schemaOf(
    table('inv', 'src/invoicing.ts'),
    table('pay', 'src/invoicing.ts'),
    table('usr', 'src/users.ts'),
  )
  const file = { kind: 'file', path: 'src/invoicing.ts' } as const

  it('adopts a file whose tables are all placed by hand in the group', () => {
    const config = cfg([group('billing'), group('other')], { inv: 'billing', pay: 'billing' })
    const out = adoptOrigins(schema, config)
    expect(out.groups[0]?.origins).toEqual([file])
    expect(out.assignments).toEqual(config.assignments)
    expect(config.groups[0]?.origins).toEqual([])
  })

  it('does not adopt when only some tables of the file are placed', () => {
    const out = adoptOrigins(schema, cfg([group('billing')], { inv: 'billing' }))
    expect(out.groups[0]?.origins).toEqual([])
  })

  it('removes the file origin from other groups and never adds it twice', () => {
    const config = cfg([group('billing', file), group('other', file)], {
      inv: 'billing',
      pay: 'billing',
    })
    const out = adoptOrigins(schema, config)
    expect(out.groups[0]?.origins).toEqual([file])
    expect(out.groups[1]?.origins).toEqual([])
  })

  it('ignores unknown groups and tables without file', () => {
    const out = adoptOrigins(
      schemaOf(table('inv', 'src/invoicing.ts'), table('nofile')),
      cfg([group('billing')], { inv: 'ghost', nofile: 'billing' }),
    )
    expect(out.groups[0]?.origins).toEqual([])
  })
})

describe('withoutGroup', () => {
  it('drops the group and its placements, keeps the others', () => {
    const config = cfg([group('a'), group('b')], { x: 'a', y: 'b', z: null })
    const out = withoutGroup(config, 'a')
    expect(out.groups.map((g) => g.id)).toEqual(['b'])
    expect(out.assignments).toEqual({ y: 'b', z: null })
    expect(config.groups).toHaveLength(2)
  })
})
