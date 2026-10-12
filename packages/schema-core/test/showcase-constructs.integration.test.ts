import { describe, expect, it } from 'vitest'
import { detectSources } from '../src/detect/detect-sources.js'
import { parseSchema } from '../src/parse/parse-schema.js'
import { memoryRepo } from './helpers/memory-repo.js'

// The constructs of the showcases of plan 6e (spec §7.1), as small repositories.
const HELPDESK: Record<string, string> = {
  'package.json': JSON.stringify({
    name: 'helpdesk',
    dependencies: { 'drizzle-orm': '0.45.0' },
    devDependencies: { 'drizzle-kit': '0.31.0' },
  }),
  'tsconfig.json': `{
  // Path aliases of the application
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
  },
}
`,
  'drizzle.config.ts': `import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  casing: 'snake_case',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
})
`,
  'src/db/columns.ts': `import { timestamp } from 'drizzle-orm/pg-core'

export const timestamps = {
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp(),
}
`,
  'src/db/schema/index.ts': `export * from './organizations'
export * from './tickets'
export * from './audit'
`,
  'src/db/schema/organizations.ts': `import { index, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core'
import { timestamps } from '@/db/columns'

export const organizations = pgTable('organizations', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  ...timestamps,
})

export const members = pgTable(
  'members',
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid().notNull(),
    role: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] }), index('members_user_idx').on(t.userId)],
)
`,
  'src/db/schema/tickets.ts': `import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  pgView,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { timestamps } from '@/db/columns'
import { members, organizations } from './organizations'

export const ticketStatus = pgEnum('ticket_status', ['open', 'pending', 'closed'])

export const tickets = pgTable(
  'tickets',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    assigneeId: uuid(),
    number: integer().notNull(),
    status: ticketStatus().notNull().default('open'),
    priority: integer().notNull(),
    ...timestamps,
  },
  (t) => [
    unique('tickets_org_number_unique').on(t.organizationId, t.number),
    foreignKey({
      columns: [t.organizationId, t.assigneeId],
      foreignColumns: [members.organizationId, members.userId],
      name: 'tickets_assignee_fk',
    }).onDelete('set null'),
    check('tickets_priority_check', sql\`\${t.priority} between 1 and 4\`),
    uniqueIndex().on(t.organizationId, t.status, t.number),
  ],
)

export const openTickets = pgView('open_tickets').as((qb) => qb.select().from(tickets))
`,
  'src/db/schema/audit.ts': `import { jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { organizations } from './organizations'

export const audit = pgSchema('audit')

export const events = audit.table('events', {
  id: uuid().primaryKey(),
  organizationId: uuid()
    .notNull()
    .references(() => organizations.id),
  action: text().notNull(),
  payload: jsonb(),
  at: timestamp().notNull().defaultNow(),
})

export const organizationsLog = audit.table('organizations', {
  id: uuid().primaryKey(),
  organizationId: uuid().references(() => organizations.id),
})
`,
}

const STOREFRONT: Record<string, string> = {
  'prisma/schema.prisma': `generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
  schemas  = ["public", "inventory"]
}
`,
  'prisma/models/catalog.prisma': `model Product {
  id       Int       @id @default(autoincrement())
  name     String
  variants Variant[]

  @@map("products")
  @@schema("public")
}

model Variant {
  productId Int         @map("product_id")
  sku       String
  price     Decimal     @db.Decimal(10, 2)
  product   Product     @relation(fields: [productId], references: [id])
  lines     OrderLine[]
  stock     Stock[]

  @@id([productId, sku])
  @@map("variants")
  @@schema("public")
}

model Stock {
  warehouse String
  productId Int     @map("product_id")
  sku       String
  quantity  Int
  variant   Variant @relation(fields: [productId, sku], references: [productId, sku], onDelete: Cascade)

  @@id([warehouse, productId, sku])
  @@map("stock")
  @@schema("inventory")
}
`,
  'prisma/models/orders.prisma': `enum OrderStatus {
  PENDING
  PAID

  @@schema("public")
}

model Order {
  id     Int         @id @default(autoincrement())
  status OrderStatus @default(PENDING)
  lines  OrderLine[]

  @@map("orders")
  @@schema("public")
}

model OrderLine {
  orderId   Int     @map("order_id")
  productId Int     @map("product_id")
  sku       String
  quantity  Int
  order     Order   @relation(fields: [orderId], references: [id])
  variant   Variant @relation(fields: [productId, sku], references: [productId, sku])

  @@id([orderId, productId, sku])
  @@map("order_lines")
  @@schema("public")
}

view ProductSales {
  productId Int @unique @map("product_id")
  total     Int

  @@map("product_sales")
  @@schema("public")
}
`,
}

async function detectAndParse(files: Record<string, string>) {
  const repo = memoryRepo(files)
  const sources = await detectSources(repo.tree, repo.readFiles)
  const [source] = sources
  if (!source || source.problem) throw new Error(JSON.stringify(sources))
  const contents = await repo.readFiles(source.files.map((file) => file.path))
  const result = await parseSchema(
    source.files.map((file) => ({ path: file.path, content: contents.get(file.path) ?? '' })),
    source.source.format,
    { casing: source.casing, unresolvedImports: source.unresolvedImports },
  )
  if (!result.ok) throw new Error(JSON.stringify(result.failure))
  return { sources, source, schema: result.schema }
}

type Link = { from: { table: string }; to: { table: string }; cardinality: string }
const links = (relationships: Link[]) =>
  relationships.map((r) => `${r.to.table} -> ${r.from.table} ${r.cardinality}`).sort()

describe('showcase constructs — Drizzle (helpdesk)', () => {
  it('detects one source through the barrel and the tsconfig alias, with its casing', async () => {
    const { sources, source } = await detectAndParse(HELPDESK)
    expect(sources.map((s) => s.source.id)).toEqual(['drizzle.config.ts'])
    expect(source.casing).toBe('snake_case')
    expect(source.files.map((file) => file.path)).toEqual([
      'src/db/columns.ts',
      'src/db/schema/audit.ts',
      'src/db/schema/index.ts',
      'src/db/schema/organizations.ts',
      'src/db/schema/tickets.ts',
    ])
    expect(source).not.toHaveProperty('unresolvedImports')
  })

  it('reads every table, the audit schema apart from public', async () => {
    const { schema } = await detectAndParse(HELPDESK)
    expect(Object.keys(schema.tables).sort()).toEqual([
      'audit.events',
      'audit.organizations',
      'members',
      'organizations',
      'tickets',
    ])
    expect(schema.tables['audit.organizations']?.schema).toBe('audit')
    expect(schema.tables.organizations?.schema).toBeNull()
    expect(schema.enums.ticket_status?.values).toEqual(['open', 'pending', 'closed'])
    expect(schema.ignoredViews).toBe(1)
  })

  it('reads spread columns under the snake_case casing, and the composite key', async () => {
    const { schema } = await detectAndParse(HELPDESK)
    expect(schema.tables.organizations?.columns.map((c) => c.name)).toEqual([
      'id',
      'name',
      'created_at',
      'updated_at',
    ])
    expect(schema.tables.tickets?.columns.map((c) => c.name)).toEqual([
      'id',
      'organization_id',
      'assignee_id',
      'number',
      'status',
      'priority',
      'created_at',
      'updated_at',
    ])
    expect(schema.tables.tickets?.columns.find((c) => c.name === 'status')?.type).toBe(
      'ticket_status',
    )
    expect(schema.tables.members?.columns.map((c) => [c.name, c.isPrimaryKey])).toEqual([
      ['organization_id', true],
      ['user_id', true],
      ['role', false],
    ])
  })

  it('reads the array extra config: unique, composite foreign key, check, unnamed unique index', async () => {
    const { schema } = await detectAndParse(HELPDESK)
    const tickets = schema.tables.tickets
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
      name: 'tickets_priority_check',
      detail: 'priority between 1 and 4',
    })
    expect(
      tickets?.indexes.find((index) => index.unique && index.columns.length === 3)?.columns,
    ).toEqual(['organization_id', 'status', 'number'])
  })

  it('links the tables, a composite-key column referenced alone staying one-to-many', async () => {
    const { schema } = await detectAndParse(HELPDESK)
    expect(links(schema.relationships)).toEqual([
      'audit.events -> organizations ONE_TO_MANY',
      'audit.organizations -> organizations ONE_TO_MANY',
      'members -> organizations ONE_TO_MANY',
      'tickets -> members ONE_TO_MANY',
      'tickets -> organizations ONE_TO_MANY',
    ])
  })
})

describe('showcase constructs — Prisma (storefront)', () => {
  it('detects prisma/schema.prisma with its models folder as one source', async () => {
    const { sources, source } = await detectAndParse(STOREFRONT)
    expect(sources.map((s) => s.source.id)).toEqual(['prisma/schema.prisma'])
    expect(source.files.map((file) => file.path)).toEqual([
      'prisma/models/catalog.prisma',
      'prisma/models/orders.prisma',
      'prisma/schema.prisma',
    ])
  })

  it('reads a Prisma 7 multi-schema model with composite keys and relations, views left out', async () => {
    const { schema } = await detectAndParse(STOREFRONT)
    expect(Object.keys(schema.tables).sort()).toEqual([
      'inventory.stock',
      'order_lines',
      'orders',
      'products',
      'variants',
    ])
    expect(schema.tables['inventory.stock']?.schema).toBe('inventory')
    expect(schema.tables.variants?.columns.map((c) => [c.name, c.isPrimaryKey])).toEqual([
      ['product_id', true],
      ['sku', true],
      ['price', false],
    ])
    expect(schema.tables['inventory.stock']?.constraints).toContainEqual({
      kind: 'foreignKey',
      name: 'StockToVariant',
      columns: ['product_id', 'sku'],
      targetTable: 'variants',
      targetColumns: ['product_id', 'sku'],
      onDelete: 'CASCADE',
      onUpdate: 'NO_ACTION',
    })
    expect(schema.enums.OrderStatus?.values).toEqual(['PENDING', 'PAID'])
    expect(schema.ignoredViews).toBe(1)
    expect(links(schema.relationships)).toEqual([
      'inventory.stock -> variants ONE_TO_MANY',
      'order_lines -> orders ONE_TO_MANY',
      'order_lines -> variants ONE_TO_MANY',
      'variants -> products ONE_TO_MANY',
    ])
  })
})
