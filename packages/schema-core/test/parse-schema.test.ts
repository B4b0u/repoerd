import { describe, expect, it } from 'vitest'
import { createParserPool, type ParserPool } from '../src/isolate/parser-pool.js'
import { parseSchema } from '../src/parse/parse-schema.js'

/** The real parser child, which also dies on "__crash__" and hangs on "__hang__". */
const TEST_CHILD = new URL('./helpers/test-child.ts', import.meta.url)

const PRISMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  ADMIN
  MEMBER
}

/// Application user
model User {
  id    String @id @default(uuid())
  email String @unique
  role  Role
  posts Post[]

  @@map("users")
}

model Post {
  id       Int    @id @default(autoincrement())
  authorId String @map("author_id")
  author   User   @relation(fields: [authorId], references: [id], onDelete: Cascade)

  @@index([authorId])
}
`

const DRIZZLE_USERS = `
import { pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core'

export const role = pgEnum('role', ['admin', 'member'])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  role: role('role').notNull(),
})
`

const DRIZZLE_POSTS = `
import { pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey(),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title'),
})
`

const DRIZZLE_SCHEMAS = `
import { pgSchema, pgTable, uuid } from 'drizzle-orm/pg-core'

export const users = pgTable('users', { id: uuid('id').primaryKey() })
export const auth = pgSchema('auth')
export const authUsers = auth.table('users', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id),
})
export const sessions = auth.table('sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').references(() => authUsers.id),
})
`

const DRIZZLE_UNNAMED = `
import { index, integer, pgTable, text } from 'drizzle-orm/pg-core'

export const people = pgTable(
  'people',
  {
    id: integer().primaryKey(),
    firstName: text().notNull(),
    teamCode: integer('team_ref').references(() => teams.teamCode),
  },
  (t) => [index('people_name_idx').on(t.firstName)],
)
export const teams = pgTable('teams', { teamCode: integer().primaryKey() })
`

const PRISMA_7 = `generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
  schemas  = ["public", "audit"]
}

model User {
  id     Int     @id
  email  String  @unique
  events Event[]

  @@schema("public")
}

model Event {
  id     Int  @id
  userId Int
  user   User @relation(fields: [userId], references: [id])

  @@schema("audit")
}

view ActiveUser {
  id    Int    @unique
  email String

  @@map("active_users")
  @@schema("public")
}
`

describe('parseSchema', () => {
  it('parses a Prisma schema into the shared model', async () => {
    const result = await parseSchema([{ path: 'prisma/schema.prisma', content: PRISMA }], 'prisma')

    if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.failure)}`)
    expect(Object.keys(result.schema.tables).sort()).toEqual(['Post', 'users'])
    expect(result.schema.tables.users?.comment).toBe('Application user')
    expect(result.schema.tables.users?.columns.find((c) => c.name === 'email')?.isUnique).toBe(true)
    expect(result.schema.enums.Role?.values).toEqual(['ADMIN', 'MEMBER'])
    expect(result.schema.relationships).toEqual([
      {
        name: 'PostToUser',
        from: { table: 'users', columns: ['id'] },
        to: { table: 'Post', columns: ['author_id'] },
        cardinality: 'ONE_TO_MANY',
      },
    ])
  })

  it('parses Drizzle schemas split across files, using database column names', async () => {
    const result = await parseSchema(
      [
        { path: 'src/db/posts.ts', content: DRIZZLE_POSTS },
        { path: 'src/db/users.ts', content: DRIZZLE_USERS },
      ],
      'drizzle',
    )

    if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.failure)}`)
    const posts = result.schema.tables.posts
    expect(posts?.columns.map((c) => c.name)).toEqual(['id', 'author_id', 'title'])
    expect(posts?.columns.find((c) => c.name === 'id')?.isPrimaryKey).toBe(true)
    expect(posts?.constraints).toContainEqual({
      kind: 'foreignKey',
      name: 'posts_author_id_users_id_fk',
      columns: ['author_id'],
      targetTable: 'users',
      targetColumns: ['id'],
      onDelete: 'CASCADE',
      onUpdate: 'NO_ACTION',
    })
    expect(result.schema.tables.users?.columns.find((c) => c.name === 'id')?.default).toBe(
      'gen_random_uuid()',
    )
    expect(result.schema.enums.role?.values).toEqual(['admin', 'member'])
    expect(result.schema.relationships).toHaveLength(1)
  })

  it('expands a spread object literal declared in another file of the source', async () => {
    const result = await parseSchema(
      [
        {
          path: 'src/db/notes.ts',
          content: `import { pgTable, uuid } from 'drizzle-orm/pg-core'
import { timestamps } from './timestamps'

export const notes = pgTable('notes', { id: uuid('id').primaryKey(), ...timestamps })
`,
        },
        {
          path: 'src/db/timestamps.ts',
          content: `import { timestamp } from 'drizzle-orm/pg-core'

export const timestamps = { createdAt: timestamp('created_at'), updatedAt: timestamp('updated_at') }
`,
        },
      ],
      'drizzle',
    )

    if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.failure)}`)
    expect(result.schema.tables.notes?.columns.map((c) => c.name)).toEqual([
      'id',
      'created_at',
      'updated_at',
    ])
  })

  it('returns a parse error without ANSI colour codes when Prisma is invalid', async () => {
    const result = await parseSchema([{ path: 'schema.prisma', content: 'model {' }], 'prisma')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('parse-error')
    if (result.failure.kind !== 'parse-error') return
    expect(result.failure.message.length).toBeGreaterThan(0)
    expect(result.failure.message).not.toContain(String.fromCharCode(27))
  })

  it('returns a parse error when Drizzle reports errors', async () => {
    const result = await parseSchema(
      [{ path: 'schema.ts', content: 'export const x = pgTable(' }],
      'drizzle',
    )

    expect(result).toMatchObject({ ok: false, failure: { kind: 'parse-error' } })
  })

  it('times out when parsing exceeds the allowed duration', async () => {
    const pool = createParserPool({ size: 1, entry: TEST_CHILD })
    try {
      const result = await parseSchema([{ path: 'schema.prisma', content: '__hang__' }], 'prisma', {
        timeoutMs: 500,
        pool,
      })
      expect(result).toEqual({ ok: false, failure: { kind: 'parse-timeout' } })
    } finally {
      pool.close()
    }
  })

  it('reports a parser that died as a parse error, then parses the next schema', async () => {
    const pool = createParserPool({ size: 1, entry: TEST_CHILD })
    try {
      const died = await parseSchema([{ path: 'schema.prisma', content: '__crash__' }], 'prisma', {
        pool,
      })
      expect(died).toEqual({
        ok: false,
        failure: { kind: 'parse-error', message: 'The parser stopped unexpectedly', crashed: true },
      })
      const next = await parseSchema([{ path: 'schema.prisma', content: PRISMA }], 'prisma', {
        pool,
      })
      expect(next.ok).toBe(true)
    } finally {
      pool.close()
    }
  })
})

describe('parseSchema — Postgres schemas, casing, keys, views and sources without table', () => {
  const drizzle = (content: string, options: Parameters<typeof parseSchema>[2] = {}) =>
    parseSchema([{ path: 'db/schema.ts', content }], 'drizzle', options)

  it('names the tables of another Postgres schema `schema.table`, without collision', async () => {
    const result = await drizzle(DRIZZLE_SCHEMAS)
    if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.failure)}`)
    expect(Object.keys(result.schema.tables).sort()).toEqual([
      'auth.sessions',
      'auth.users',
      'users',
    ])
    expect(result.schema.tables['auth.users']).toMatchObject({ name: 'auth.users', schema: 'auth' })
    expect(result.schema.tables.users?.schema).toBeNull()
    expect(result.schema.relationships.map((r) => [r.to.table, r.from.table])).toEqual([
      ['auth.users', 'users'],
      ['auth.sessions', 'auth.users'],
    ])
  })

  it('applies the casing of drizzle.config to the columns declared without a name', async () => {
    const result = await drizzle(DRIZZLE_UNNAMED, { casing: 'snake_case' })
    if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.failure)}`)
    const people = result.schema.tables.people
    expect(people?.columns.map((c) => c.name)).toEqual(['id', 'first_name', 'team_ref'])
    expect(people?.indexes.find((i) => i.name === 'people_name_idx')?.columns).toEqual([
      'first_name',
    ])
    expect(result.schema.tables.teams?.columns.map((c) => [c.name, c.isPrimaryKey])).toEqual([
      ['team_code', true],
    ])
    expect(result.schema.relationships).toEqual([
      {
        name: 'people_team_ref_teams_teamCode_fk',
        from: { table: 'teams', columns: ['team_code'] },
        to: { table: 'people', columns: ['team_ref'] },
        cardinality: 'ONE_TO_MANY',
      },
    ])
  })

  it('keeps the JS keys without casing', async () => {
    const result = await drizzle(DRIZZLE_UNNAMED)
    if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.failure)}`)
    expect(result.schema.tables.people?.columns.map((c) => c.name)).toEqual([
      'id',
      'firstName',
      'team_ref',
    ])
  })

  it('marks every column of a composite key, and keeps a key column referenced alone one-to-many', async () => {
    const result = await drizzle(`
import { integer, pgTable, primaryKey } from 'drizzle-orm/pg-core'

export const orders = pgTable('orders', { id: integer('id').primaryKey() })
export const lines = pgTable(
  'order_lines',
  {
    orderId: integer('order_id').notNull().references(() => orders.id),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.position] })],
)
`)
    if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.failure)}`)
    expect(result.schema.tables.order_lines?.columns.map((c) => [c.name, c.isPrimaryKey])).toEqual([
      ['order_id', true],
      ['position', true],
    ])
    expect(result.schema.relationships.map((r) => r.cardinality)).toEqual(['ONE_TO_MANY'])
  })

  it('counts the views it does not draw', async () => {
    const result = await drizzle(`
import { pgTable, pgView, uuid } from 'drizzle-orm/pg-core'

export const users = pgTable('users', { id: uuid('id').primaryKey() })
export const active = pgView('active_users').as((qb) => qb.select().from(users))
`)
    if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.failure)}`)
    expect(Object.keys(result.schema.tables)).toEqual(['users'])
    expect(result.schema.ignoredViews).toBe(1)
  })

  it('reports files that give no table, with the imports detection could not follow', async () => {
    expect(
      await drizzle("export * from '@/db/tables'\n", { unresolvedImports: ['@/db/tables'] }),
    ).toEqual({
      ok: false,
      failure: { kind: 'no-tables-found', unresolvedImports: ['@/db/tables'] },
    })
    expect(
      await parseSchema(
        [
          {
            path: 'prisma/schema.prisma',
            content: 'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n',
          },
        ],
        'prisma',
      ),
    ).toEqual({ ok: false, failure: { kind: 'no-tables-found', unresolvedImports: [] } })
  })

  it('keeps an empty schema for blank files', async () => {
    expect(await drizzle('\n  \n')).toEqual({
      ok: true,
      schema: { tables: {}, enums: {}, relationships: [] },
    })
  })
})

describe('parseSchema — current Prisma schemas', () => {
  it('parses a Prisma 7 schema: no url, multiSchema without preview flag, views left out', async () => {
    const result = await parseSchema(
      [{ path: 'prisma/schema.prisma', content: PRISMA_7 }],
      'prisma',
    )
    if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.failure)}`)
    expect(Object.keys(result.schema.tables).sort()).toEqual(['User', 'audit.Event'])
    expect(result.schema.tables['audit.Event']?.schema).toBe('audit')
    expect(result.schema.ignoredViews).toBe(1)
    expect(result.schema.relationships.map((r) => [r.to.table, r.from.table])).toEqual([
      ['audit.Event', 'User'],
    ])
  })

  it('tells the web that Prisma refused the schema, not Drizzle errors', async () => {
    const prisma = await parseSchema([{ path: 'schema.prisma', content: 'model {' }], 'prisma')
    expect(prisma).toMatchObject({
      ok: false,
      failure: { kind: 'parse-error', rejectedByPrisma: true },
    })
    const drizzle = await parseSchema(
      [{ path: 'schema.ts', content: 'export const x = pgTable(' }],
      'drizzle',
    )
    if (drizzle.ok) throw new Error('expected a parse error')
    expect(drizzle.failure).toMatchObject({ kind: 'parse-error' })
    expect(drizzle.failure).not.toHaveProperty('rejectedByPrisma')
  })

  it('does not blame Prisma for an exception of the parser itself', async () => {
    const pool = {
      parse: async () => ({
        kind: 'failed' as const,
        message: "TypeError: Cannot read properties of undefined (reading 'name')",
      }),
    } as unknown as ParserPool
    const result = await parseSchema([{ path: 'schema.prisma', content: 'x' }], 'prisma', { pool })
    if (result.ok) throw new Error('expected a parse error')
    expect(result.failure).toMatchObject({ kind: 'parse-error' })
    expect(result.failure).not.toHaveProperty('rejectedByPrisma')
  })
})

describe('parseSchema — Prisma refusals', () => {
  it('reports the real error of an unclosed block, without the injected generator', async () => {
    const result = await parseSchema(
      [{ path: 'schema.prisma', content: 'model A {\n  id Int @id\n' }],
      'prisma',
    )
    if (result.ok || result.failure.kind !== 'parse-error') throw new Error('expected parse-error')
    expect(result.failure.message).not.toContain('repoerd')
    expect(result.failure.message).not.toContain('prisma-client-js')
    expect(result.failure.message).toContain('model A')
  })

  it('keeps the user line numbers and hides the placeholder url', async () => {
    const content =
      'datasource db {\n  provider = "postgresql"\n}\n\nmodel A {\n  id Int @id @bogus\n}\n'
    const result = await parseSchema([{ path: 'schema.prisma', content }], 'prisma')
    if (result.ok || result.failure.kind !== 'parse-error') throw new Error('expected parse-error')
    expect(result.failure.message).toContain('schema.prisma:6')
    expect(result.failure.message).not.toContain('localhost/repoerd')
  })
})

describe('parseSchema — Prisma refusals on the real coloured messages', () => {
  const failureOf = async (content: string) => {
    const result = await parseSchema([{ path: 'schema.prisma', content }], 'prisma')
    if (result.ok || result.failure.kind !== 'parse-error') throw new Error('expected parse-error')
    return result.failure
  }

  it('shows the user line of a failure after a url-less datasource', async () => {
    const failure = await failureOf(
      'datasource db {\n  provider = "postgresql"\n}\n\nmodel A {\n  b Bogus\n}\n',
    )
    expect(failure.message).toContain('schema.prisma:6')
    expect(failure.message).toMatch(/^\s*6 \|\s+b Bogus/m)
    expect(failure.message).not.toMatch(/^\s*7 \|/m)
    expect(failure.message).not.toContain('localhost/repoerd')
  })

  it('never shows the placeholder url of several datasources', async () => {
    const failure = await failureOf(
      'datasource a {\n  provider = "postgresql"\n}\ndatasource b {\n  provider = "postgresql"\n}\n',
    )
    expect(failure.message).not.toContain('localhost/repoerd')
  })

  it.each(['model {', 'modle User {', 'model 1A {'])(
    'reports the real error of %s',
    async (line) => {
      const failure = await failureOf(`${line}\n  id Int @id\n`)
      expect(failure.message).not.toContain('repoerd')
      expect(failure.message).not.toContain('prisma-client-js')
    },
  )
})
