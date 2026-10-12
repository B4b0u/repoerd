import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { timestamps } from '@/db/columns'
import { contacts } from './customers'
import { channel, ticketPriority, ticketStatus } from './enums'
import { members, organizations, teams, users } from './organizations'
import { slaPolicies } from './sla'

export const tickets = pgTable(
  'tickets',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    number: integer().notNull(),
    subject: text().notNull(),
    status: ticketStatus().notNull().default('new'),
    priority: ticketPriority().notNull().default('normal'),
    channel: channel().notNull().default('email'),
    requesterId: uuid()
      .notNull()
      .references(() => contacts.id),
    assigneeId: uuid(),
    teamId: uuid().references(() => teams.id, { onDelete: 'set null' }),
    slaPolicyId: uuid().references(() => slaPolicies.id),
    dueAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique('tickets_org_number_unique').on(t.organizationId, t.number),
    foreignKey({
      columns: [t.organizationId, t.assigneeId],
      foreignColumns: [members.organizationId, members.userId],
      name: 'tickets_assignee_fk',
    }).onDelete('set null'),
    index('tickets_queue_idx').on(t.organizationId, t.status, t.priority),
    check('tickets_number_positive', sql`${t.number} > 0`),
  ],
)

export const messages = pgTable(
  'messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    ticketId: uuid()
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    authorUserId: uuid().references(() => users.id),
    authorContactId: uuid().references(() => contacts.id),
    body: text().notNull(),
    internal: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('messages_ticket_idx').on(t.ticketId, t.createdAt),
    check(
      'messages_one_author',
      sql`(${t.authorUserId} is null) <> (${t.authorContactId} is null)`,
    ),
  ],
)

export const attachments = pgTable('attachments', {
  id: uuid().primaryKey().defaultRandom(),
  messageId: uuid()
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  fileName: text().notNull(),
  contentType: text().notNull(),
  sizeBytes: integer().notNull(),
  storageKey: text().notNull().unique(),
})

export const tags = pgTable(
  'tags',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
  },
  (t) => [unique('tags_org_name_unique').on(t.organizationId, t.name)],
)

export const ticketTags = pgTable(
  'ticket_tags',
  {
    ticketId: uuid()
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    tagId: uuid()
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.ticketId, t.tagId] })],
)

/** Canned replies agents insert into messages. */
export const macros = pgTable('macros', {
  id: uuid().primaryKey().defaultRandom(),
  organizationId: uuid()
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  title: text().notNull(),
  body: text().notNull(),
  createdById: uuid().references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
})

export const satisfactionRatings = pgTable('satisfaction_ratings', {
  ticketId: uuid()
    .primaryKey()
    .references(() => tickets.id, { onDelete: 'cascade' }),
  score: smallint().notNull(),
  comment: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})
