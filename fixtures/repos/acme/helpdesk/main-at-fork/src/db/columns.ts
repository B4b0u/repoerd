import { timestamp } from 'drizzle-orm/pg-core'

/** Every table records when its rows were created and last changed. */
export const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}
