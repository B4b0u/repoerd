import { integer, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { escalationLevel } from './enums'
import { teams, users } from './organizations'
import { slaPolicies } from './sla'
import { tickets } from './tickets'

/** When a ticket misses its target by this many minutes, it climbs to `level`. */
export const escalationRules = pgTable(
  'escalation_rules',
  {
    id: uuid().primaryKey().defaultRandom(),
    policyId: uuid()
      .notNull()
      .references(() => slaPolicies.id, { onDelete: 'cascade' }),
    level: escalationLevel().notNull(),
    afterMinutes: integer().notNull(),
    notifyTeamId: uuid().references(() => teams.id, { onDelete: 'set null' }),
  },
  (t) => [unique('escalation_rules_policy_level_unique').on(t.policyId, t.level)],
)

export const escalations = pgTable('escalations', {
  id: uuid().primaryKey().defaultRandom(),
  ticketId: uuid()
    .notNull()
    .references(() => tickets.id, { onDelete: 'cascade' }),
  ruleId: uuid()
    .notNull()
    .references(() => escalationRules.id),
  level: escalationLevel().notNull(),
  escalatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  acknowledgedById: uuid().references(() => users.id, { onDelete: 'set null' }),
  acknowledgedAt: timestamp({ withTimezone: true }),
})
