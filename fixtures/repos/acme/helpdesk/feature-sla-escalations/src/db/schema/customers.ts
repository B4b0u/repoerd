import { pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { timestamps } from '@/db/columns'
import { organizations } from './organizations'

export const companies = pgTable('companies', {
  id: uuid().primaryKey().defaultRandom(),
  organizationId: uuid()
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  domain: text(),
  ...timestamps,
})

/** The people who ask for help: they never sign in. */
export const contacts = pgTable(
  'contacts',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    companyId: uuid().references(() => companies.id, { onDelete: 'set null' }),
    email: text().notNull(),
    name: text(),
    phone: text(),
    ...timestamps,
  },
  (t) => [uniqueIndex('contacts_org_email_idx').on(t.organizationId, t.email)],
)
