import { customType } from 'drizzle-orm/pg-core'

/** Case-insensitive text (the citext extension). */
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext'
  },
})

/** Full-text search document. */
export const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' })
