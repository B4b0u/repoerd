import { integer, pgTable, smallint, text, time, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { timestamps } from '@/db/columns'
import { ticketPriority } from './enums'
import { organizations } from './organizations'

export const slaPolicies = pgTable('sla_policies', {
  id: uuid().primaryKey().defaultRandom(),
  organizationId: uuid()
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  description: text(),
  ...timestamps,
})

/** Response and resolution times of a policy, per ticket priority. */
export const slaTargets = pgTable(
  'sla_targets',
  {
    id: uuid().primaryKey().defaultRandom(),
    policyId: uuid()
      .notNull()
      .references(() => slaPolicies.id, { onDelete: 'cascade' }),
    priority: ticketPriority().notNull(),
    firstResponseMinutes: integer().notNull(),
    resolutionMinutes: integer().notNull(),
  },
  (t) => [unique('sla_targets_policy_priority_unique').on(t.policyId, t.priority)],
)

export const businessHours = pgTable('business_hours', {
  id: uuid().primaryKey().defaultRandom(),
  organizationId: uuid()
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  timezone: varchar({ length: 64 }).notNull(),
  weekday: smallint().notNull(),
  opensAt: time().notNull(),
  closesAt: time().notNull(),
})
