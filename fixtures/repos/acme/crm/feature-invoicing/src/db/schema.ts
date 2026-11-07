import {
  customType,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { tenant, timestamps } from './columns'
import { citext, tsvector } from './types'

export const role = pgEnum('role', ['owner', 'admin', 'member'])
export const activityKind = pgEnum('activity_kind', ['call', 'email', 'meeting', 'task'])

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: citext('slug').notNull().unique(),
  ...timestamps(),
})

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  name: text('name').notNull(),
  ...timestamps(),
})

export const memberships = pgTable(
  'memberships',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: role('role').notNull().default('member'),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
)

export const companies = pgTable('companies', {
  ...tenant(),
  name: text('name').notNull(),
  domain: citext('domain'),
  search: tsvector('search'),
  ...timestamps(),
})

export const contacts = pgTable('contacts', {
  ...tenant(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
  email: citext('email').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  ...timestamps(),
})

export const pipelines = pgTable('pipelines', {
  ...tenant(),
  name: text('name').notNull(),
})

export const stages = pgTable('stages', {
  ...tenant(),
  pipelineId: uuid('pipeline_id')
    .notNull()
    .references(() => pipelines.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  position: integer('position').notNull(),
})

export const deals = pgTable('deals', {
  ...tenant(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  stageId: uuid('stage_id')
    .notNull()
    .references(() => stages.id),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  search: tsvector('search'),
  amount: customType<{ data: string }>({ dataType: () => 'numeric(12, 2)' })('amount').notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  ...timestamps(),
})

export const activities = pgTable('activities', {
  ...tenant(),
  dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  kind: activityKind('kind').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }),
  ...timestamps(),
})

export const notes = pgTable('notes', {
  ...tenant(),
  dealId: uuid('deal_id')
    .notNull()
    .references(() => deals.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  body: text('body').notNull(),
  search: tsvector('search'),
  ...timestamps(),
})

export const tags = pgTable('tags', {
  ...tenant(),
  name: citext('name').notNull(),
})

export const dealTags = pgTable(
  'deal_tags',
  {
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.dealId, t.tagId] })],
)

export const invoiceStatus = pgEnum('invoice_status', ['draft', 'sent', 'paid', 'void'])

export const invoices = pgTable('invoices', {
  ...tenant(),
  dealId: uuid('deal_id')
    .notNull()
    .references(() => deals.id),
  number: citext('number').notNull(),
  status: invoiceStatus('status').notNull().default('draft'),
  total: customType<{ data: string }>({ dataType: () => 'numeric(12, 2)' })('total').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  ...timestamps(),
})

export const invoiceLines = pgTable('invoice_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  quantity: integer('quantity').notNull().default(1),
  unitPrice: customType<{ data: string }>({ dataType: () => 'numeric(12, 2)' })('unit_price').notNull(),
})
