import { pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { posts } from './posts'

export const tagKind = pgEnum('tag_kind', ['topic', 'series'])

export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  kind: tagKind('kind').notNull().default('topic'),
})

export const postTags = pgTable('post_tags', {
  postId: uuid('post_id')
    .notNull()
    .references(() => posts.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id')
    .notNull()
    .references(() => tags.id, { onDelete: 'cascade' }),
})
