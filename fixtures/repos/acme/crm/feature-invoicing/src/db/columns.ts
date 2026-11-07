import { timestamp, uuid } from 'drizzle-orm/pg-core'
import { workspaces } from './schema'

/** The key of the rows a workspace owns. */
export const tenant = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
})

/** When a row was created and last changed. */
export function timestamps() {
  return {
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  }
}
