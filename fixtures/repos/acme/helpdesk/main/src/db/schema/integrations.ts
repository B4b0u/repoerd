import { boolean, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { timestamps } from '@/db/columns'
import { organizations } from './organizations'

/** Outgoing notifications of ticket events to other tools. */
export const webhooks = pgTable('webhooks', {
  id: uuid().primaryKey().defaultRandom(),
  organizationId: uuid()
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  url: text().notNull(),
  secret: text().notNull(),
  events: jsonb().notNull(),
  active: boolean().notNull().default(true),
  ...timestamps,
})
