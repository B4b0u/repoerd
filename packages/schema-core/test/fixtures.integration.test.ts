import { describe, expect, it } from 'vitest'
import { detectSources } from '../src/detect/detect-sources.js'
import { parseSchema } from '../src/parse/parse-schema.js'
import { loadSnapshot } from './helpers/load-snapshot.js'

async function detectAndParse(owner: string, repo: string, snapshot = 'main') {
  const snap = loadSnapshot(owner, repo, snapshot)
  const sources = await detectSources(snap.tree, snap.readFiles)
  const first = sources[0]
  if (!first || first.problem) return { sources, result: undefined }
  const contents = await snap.readFiles(first.files.map((f) => f.path))
  const files = first.files.map((f) => ({ path: f.path, content: contents.get(f.path) ?? '' }))
  // The hints of the detection, as the server passes them (Drizzle casing, unresolved imports).
  const hints = { casing: first.casing, unresolvedImports: first.unresolvedImports }
  return { sources, result: await parseSchema(files, first.source.format, hints) }
}

async function schemaOf(owner: string, repo: string, snapshot = 'main') {
  const { result } = await detectAndParse(owner, repo, snapshot)
  if (!result?.ok) throw new Error(JSON.stringify(result))
  return result.schema
}

describe('fixtures — detect and parse end to end', () => {
  it('acme/shop-prisma main', async () => {
    const { sources, result } = await detectAndParse('acme', 'shop-prisma')
    expect(sources.map((s) => s.source.id)).toEqual(['prisma/schema.prisma'])
    if (!result?.ok) throw new Error(JSON.stringify(result))
    expect(Object.keys(result.schema.tables).sort()).toEqual([
      'order_items',
      'orders',
      'products',
      'users',
    ])
    expect(result.schema.relationships).toHaveLength(3)
    expect(result.schema.enums.OrderStatus?.values).toEqual(['PENDING', 'PAID', 'SHIPPED'])
  })

  it('acme/shop-prisma feature-add-reviews', async () => {
    const { result } = await detectAndParse('acme', 'shop-prisma', 'feature-add-reviews')
    if (!result?.ok) throw new Error(JSON.stringify(result))
    expect(Object.keys(result.schema.tables)).toContain('reviews')
    expect(result.schema.relationships).toHaveLength(5)
  })

  it('acme/blog-drizzle follows the barrel file', async () => {
    const { sources, result } = await detectAndParse('acme', 'blog-drizzle')
    expect(sources[0]?.files.map((f) => f.path)).toEqual([
      'src/db/schema/comments.ts',
      'src/db/schema/index.ts',
      'src/db/schema/posts.ts',
      'src/db/schema/users.ts',
    ])
    if (!result?.ok) throw new Error(JSON.stringify(result))
    expect(Object.keys(result.schema.tables).sort()).toEqual(['comments', 'posts', 'users'])
    expect(result.schema.relationships).toHaveLength(3)
  })

  it('acme/platform-monorepo (config in a package, glob relative to the package, ~100 files)', async () => {
    const { sources, result } = await detectAndParse('acme', 'platform-monorepo')
    const db = 'packages/core/src/infrastructure/database'
    expect(sources.map((s) => s.source.id)).toEqual([`${db}/drizzle.config.ts`])
    const paths = sources[0]?.files.map((f) => f.path) ?? []
    expect(paths).toHaveLength(104)
    expect(paths).toContain(`${db}/columns.ts`)
    expect(paths).not.toContain(`${db}/naming.ts`)
    expect(paths).not.toContain(`${db}/schemas/drizzle-entity-001.schema.test.ts`)
    if (!result?.ok) throw new Error(JSON.stringify(result))
    expect(Object.keys(result.schema.tables)).toHaveLength(102)
    expect(result.schema.relationships).toHaveLength(200)
    expect(result.schema.enums.record_status?.values).toEqual(['active', 'archived'])
  })

  it('acme/multi-source exposes two sources', async () => {
    const { sources } = await detectAndParse('acme', 'multi-source')
    expect(sources.map((s) => [s.source.id, s.source.format])).toEqual([
      ['apps/api/prisma/schema.prisma', 'prisma'],
      ['packages/billing/drizzle.config.ts', 'drizzle'],
    ])
  })

  it('acme/no-schema has no source', async () => {
    const { sources } = await detectAndParse('acme', 'no-schema')
    expect(sources).toEqual([])
  })

  it('acme/broken-prisma fails with a parse error', async () => {
    const { result } = await detectAndParse('acme', 'broken-prisma')
    expect(result).toMatchObject({ ok: false, failure: { kind: 'parse-error' } })
  })
})

/** The 24 tables of acme/storefront at the fork point of feature/subscriptions. */
const STOREFRONT_AT_FORK = [
  'addresses',
  'brands',
  'cart_items',
  'carts',
  'categories',
  'coupon_redemptions',
  'coupons',
  'customers',
  'gift_cards',
  'inventory.stock_levels',
  'inventory.stock_reservations',
  'inventory.warehouses',
  'legacy_order_notes',
  'order_items',
  'orders',
  'payments',
  'product_categories',
  'product_images',
  'product_variants',
  'products',
  'refunds',
  'reviews',
  'shipment_items',
  'shipments',
]

describe('showcase acme/storefront (Prisma)', () => {
  it('detects the Prisma 7 schema and its models folder as one source', async () => {
    const { sources } = await detectAndParse('acme', 'storefront')
    expect(sources.map((s) => s.source.id)).toEqual(['prisma/schema.prisma'])
    expect(sources[0]?.files.map((f) => f.path)).toEqual([
      'prisma/models/catalog.prisma',
      'prisma/models/customers.prisma',
      'prisma/models/inventory.prisma',
      'prisma/models/marketing.prisma',
      'prisma/models/orders.prisma',
      'prisma/schema.prisma',
    ])
  })

  it('reads the fork point, main and the subscriptions branch', async () => {
    const fork = await schemaOf('acme', 'storefront', 'main-at-fork')
    expect(Object.keys(fork.tables).sort()).toEqual(STOREFRONT_AT_FORK)
    expect(fork.relationships).toHaveLength(31)

    const main = await schemaOf('acme', 'storefront', 'main')
    expect(Object.keys(main.tables).sort()).toEqual(
      [...STOREFRONT_AT_FORK, 'gift_card_transactions'].sort(),
    )
    expect(main.relationships).toHaveLength(33)

    const feature = await schemaOf('acme', 'storefront', 'feature-subscriptions')
    expect(Object.keys(feature.tables).sort()).toEqual(
      [
        ...STOREFRONT_AT_FORK.filter((table) => table !== 'legacy_order_notes'),
        'plan_items',
        'plans',
        'subscriptions',
      ].sort(),
    )
    expect(feature.relationships).toHaveLength(36)
  })

  it('keeps the composite keys, the composite foreign key and the category tree', async () => {
    const { tables, enums } = await schemaOf('acme', 'storefront')
    expect(tables['inventory.stock_levels']?.schema).toBe('inventory')
    expect(
      tables.cart_items?.columns.filter((column) => column.isPrimaryKey).map((c) => c.name),
    ).toEqual(['cart_id', 'variant_id'])
    expect(tables['inventory.stock_reservations']?.constraints).toContainEqual({
      kind: 'foreignKey',
      name: 'StockLevelToStockReservation',
      columns: ['warehouse_id', 'variant_id'],
      targetTable: 'inventory.stock_levels',
      targetColumns: ['warehouse_id', 'variant_id'],
      onDelete: 'CASCADE',
      onUpdate: 'NO_ACTION',
    })
    expect(tables.categories?.constraints).toContainEqual({
      kind: 'foreignKey',
      name: 'CategoryTree',
      columns: ['parent_id'],
      targetTable: 'categories',
      targetColumns: ['id'],
      onDelete: 'SET_NULL',
      onUpdate: 'NO_ACTION',
    })
    expect(tables._CategoryTree).toBeUndefined()
    expect(Object.keys(enums).sort()).toEqual([
      'DiscountKind',
      'OrderStatus',
      'PaymentProvider',
      'PaymentStatus',
      'ProductStatus',
      'ShipmentStatus',
    ])
  })
})

/** The 20 tables of acme/helpdesk at the fork point of feature/sla-escalations. */
const HELPDESK_AT_FORK = [
  'api_keys',
  'attachments',
  'audit.events',
  'audit.sign_ins',
  'business_hours',
  'companies',
  'contacts',
  'macros',
  'members',
  'messages',
  'organizations',
  'satisfaction_ratings',
  'sla_policies',
  'sla_targets',
  'tags',
  'team_members',
  'teams',
  'ticket_tags',
  'tickets',
  'users',
]

describe('showcase acme/helpdesk (Drizzle)', () => {
  it('follows the barrel and the tsconfig alias, with the snake_case casing', async () => {
    const { sources } = await detectAndParse('acme', 'helpdesk')
    expect(sources.map((s) => [s.source.id, s.casing])).toEqual([
      ['drizzle.config.ts', 'snake_case'],
    ])
    expect(sources[0]?.files.map((f) => f.path)).toEqual([
      'src/db/columns.ts',
      'src/db/schema/audit.ts',
      'src/db/schema/customers.ts',
      'src/db/schema/enums.ts',
      'src/db/schema/index.ts',
      'src/db/schema/integrations.ts',
      'src/db/schema/organizations.ts',
      'src/db/schema/sla.ts',
      'src/db/schema/tickets.ts',
    ])
  })

  it('reads the fork point, main and the escalations branch', async () => {
    const fork = await schemaOf('acme', 'helpdesk', 'main-at-fork')
    expect(Object.keys(fork.tables).sort()).toEqual(HELPDESK_AT_FORK)
    expect(fork.relationships).toHaveLength(30)

    const main = await schemaOf('acme', 'helpdesk', 'main')
    expect(Object.keys(main.tables).sort()).toEqual([...HELPDESK_AT_FORK, 'webhooks'].sort())
    expect(main.relationships).toHaveLength(31)

    const feature = await schemaOf('acme', 'helpdesk', 'feature-sla-escalations')
    expect(Object.keys(feature.tables).sort()).toEqual(
      [...HELPDESK_AT_FORK, 'escalation_rules', 'escalations'].sort(),
    )
    expect(feature.relationships).toHaveLength(35)
  })

  it('reads the array extra config, spread columns and the audit schema', async () => {
    const { tables, enums } = await schemaOf('acme', 'helpdesk')
    expect(tables['audit.events']?.schema).toBe('audit')
    expect(tables.organizations?.columns.map((c) => c.name)).toEqual([
      'id',
      'name',
      'slug',
      'plan',
      'created_at',
      'updated_at',
    ])
    expect(tables.members?.columns.filter((c) => c.isPrimaryKey).map((c) => c.name)).toEqual([
      'organization_id',
      'user_id',
    ])
    const tickets = tables.tickets
    expect(tickets?.columns.find((c) => c.name === 'status')?.type).toBe('ticket_status')
    expect(tickets?.constraints).toContainEqual({
      kind: 'unique',
      name: 'tickets_org_number_unique',
      columns: ['organization_id', 'number'],
    })
    expect(tickets?.constraints).toContainEqual({
      kind: 'foreignKey',
      name: 'tickets_assignee_fk',
      columns: ['organization_id', 'assignee_id'],
      targetTable: 'members',
      targetColumns: ['organization_id', 'user_id'],
      onDelete: 'SET_NULL',
      onUpdate: 'NO_ACTION',
    })
    expect(tickets?.constraints).toContainEqual({
      kind: 'check',
      name: 'tickets_number_positive',
      detail: 'number > 0',
    })
    expect(tickets?.indexes.find((index) => index.name === 'tickets_queue_idx')?.columns).toEqual([
      'organization_id',
      'status',
      'priority',
    ])
    expect(Object.keys(enums).sort()).toEqual([
      'channel',
      'member_role',
      'ticket_priority',
      'ticket_status',
    ])
  })
})
