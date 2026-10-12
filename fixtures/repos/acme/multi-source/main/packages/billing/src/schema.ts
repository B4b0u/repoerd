import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core'

export const invoices = pgTable('invoices', {
  id: serial('id').primaryKey(),
  number: text('number').notNull().unique(),
  amountCents: integer('amount_cents').notNull(),
})
