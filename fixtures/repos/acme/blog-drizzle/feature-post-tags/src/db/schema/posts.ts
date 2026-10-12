import { pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  title: text('title'),
  slug: text('slug').notNull().unique(),
  body: varchar('body', { length: 5000 }),
})
