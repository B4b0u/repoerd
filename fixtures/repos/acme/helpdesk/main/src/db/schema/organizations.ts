import { index, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { timestamps } from '@/db/columns'
import { memberRole } from './enums'

export const organizations = pgTable('organizations', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  plan: text().notNull().default('free'),
  ...timestamps,
})

/** Agents and administrators: people who sign in to the help desk. */
export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  name: text().notNull(),
  avatarUrl: text(),
  lastSignInAt: timestamp({ withTimezone: true }),
  ...timestamps,
})

export const members = pgTable(
  'members',
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRole().notNull().default('agent'),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),
    index('members_user_idx').on(t.userId),
  ],
)

export const teams = pgTable(
  'teams',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    ...timestamps,
  },
  (t) => [unique('teams_org_name_unique').on(t.organizationId, t.name)],
)

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid()
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
)

export const apiKeys = pgTable('api_keys', {
  id: uuid().primaryKey().defaultRandom(),
  organizationId: uuid()
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  prefix: text().notNull().unique(),
  hashedKey: text().notNull(),
  lastUsedAt: timestamp({ withTimezone: true }),
  ...timestamps,
})
