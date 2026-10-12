import { jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { organizations, users } from './organizations'

/** Append-only records, kept apart from the application tables. */
export const audit = pgSchema('audit')

export const events = audit.table('events', {
  id: uuid().primaryKey().defaultRandom(),
  organizationId: uuid()
    .notNull()
    .references(() => organizations.id),
  actorUserId: uuid().references(() => users.id),
  action: text().notNull(),
  entity: text().notNull(),
  entityId: uuid().notNull(),
  payload: jsonb(),
  at: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const signIns = audit.table('sign_ins', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .notNull()
    .references(() => users.id),
  ipAddress: text().notNull(),
  userAgent: text(),
  at: timestamp({ withTimezone: true }).notNull().defaultNow(),
})
