import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { parse } from '@liam-hq/schema/parser'
import { describe, expect, it } from 'vitest'
import type { PatchedLiamSchema } from '../src/parse/liam-patch.js'

/** The dist folder of the installed (patched) @liam-hq/schema. */
const LIAM_DIST = path.dirname(createRequire(import.meta.url).resolve('@liam-hq/schema/parser'))

/** The dist files the patch modifies, read from the patch itself. */
const PATCHED_FILES = [
  ...readFileSync(
    new URL('../../../patches/@liam-hq__schema@0.6.1.patch', import.meta.url),
    'utf8',
  ).matchAll(/^diff --git a\/dist\/(\S+)/gm),
].map((match) => match[1] as string)

describe('the patch of @liam-hq/schema', () => {
  it('modifies the Drizzle and Prisma parsers', () => {
    expect(PATCHED_FILES).toEqual(
      expect.arrayContaining(['parser/drizzle/postgres/tableParser.js', 'parser/prisma/parser.js']),
    )
  })

  it.each(PATCHED_FILES)('marks %s as modified (Apache 2.0 §4(b))', (file) => {
    const firstLine = readFileSync(path.join(LIAM_DIST, file), 'utf8').split('\n')[0]
    expect(firstLine).toMatch(/^\/\/ Modified by RepoERD: \S/)
  })
})

const PG = `import { check, foreignKey, index, integer, pgMaterializedView, pgSchema, pgTable, pgView, primaryKey, text, timestamp, unique, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
`

async function parseDrizzle(source: string): Promise<PatchedLiamSchema> {
  const result = await parse(`${PG}${source}`, 'drizzle')
  expect(result.errors.map((error) => error.message)).toEqual([])
  return result.value
}

describe('patched Liam — Drizzle', () => {
  it('reads the extra config in array form like the object form', async () => {
    const schema = await parseDrizzle(`
export const members = pgTable('members', {
  orgId: integer('org_id').notNull(),
  userId: uuid('user_id').notNull(),
  email: text('email'),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.userId] }),
  index('members_email_idx').on(t.email),
  uniqueIndex('members_user_idx').using('btree', t.userId),
  unique('members_email_unique').on(t.email),
  check('members_org_positive', sql\`\${t.orgId} > 0\`),
])
`)
    const members = schema.tables.members
    expect(members?.constraints).toEqual({
      members_pkey: {
        type: 'PRIMARY KEY',
        name: 'members_pkey',
        columnNames: ['org_id', 'user_id'],
      },
      members_email_unique: {
        type: 'UNIQUE',
        name: 'members_email_unique',
        columnNames: ['email'],
      },
      members_org_positive: { type: 'CHECK', name: 'members_org_positive', detail: 'org_id > 0' },
    })
    expect(members?.indexes).toEqual({
      members_pkey: {
        name: 'members_pkey',
        columns: ['org_id', 'user_id'],
        unique: true,
        type: '',
      },
      members_email_idx: { name: 'members_email_idx', columns: ['email'], unique: false, type: '' },
      members_user_idx: {
        name: 'members_user_idx',
        columns: ['user_id'],
        unique: true,
        type: 'btree',
      },
    })
  })

  it('turns unique().on() and composite or self-referencing foreignKey() into constraints', async () => {
    const schema = await parseDrizzle(`
export const orgs = pgTable('orgs', { id: integer('id').primaryKey(), code: text('code') })
export const teams = pgTable('teams', {
  orgId: integer('org_id').notNull(),
  code: text('code').notNull(),
  parentOrgId: integer('parent_org_id'),
  parentCode: text('parent_code'),
}, (t) => ({
  pk: primaryKey({ columns: [t.orgId, t.code] }),
  codeUnique: unique().on(t.code, t.orgId),
  org: foreignKey({ columns: [t.orgId], foreignColumns: [orgs.id] }).onDelete('cascade').onUpdate('restrict'),
  parent: foreignKey({ columns: [t.parentOrgId, t.parentCode], foreignColumns: [t.orgId, t.code], name: 'teams_parent_fk' }),
}))
`)
    expect(schema.tables.teams?.constraints).toEqual({
      teams_pkey: { type: 'PRIMARY KEY', name: 'teams_pkey', columnNames: ['org_id', 'code'] },
      teams_code_org_id_unique: {
        type: 'UNIQUE',
        name: 'teams_code_org_id_unique',
        columnNames: ['code', 'org_id'],
      },
      teams_org_id_orgs_id_fk: {
        type: 'FOREIGN KEY',
        name: 'teams_org_id_orgs_id_fk',
        columnNames: ['org_id'],
        targetTableName: 'orgs',
        targetColumnNames: ['id'],
        updateConstraint: 'RESTRICT',
        deleteConstraint: 'CASCADE',
      },
      teams_parent_fk: {
        type: 'FOREIGN KEY',
        name: 'teams_parent_fk',
        columnNames: ['parent_org_id', 'parent_code'],
        targetTableName: 'teams',
        targetColumnNames: ['org_id', 'code'],
        updateConstraint: 'NO_ACTION',
        deleteConstraint: 'NO_ACTION',
      },
    })
  })

  it('adds the columns of spread top-level object literals, in place', async () => {
    const schema = await parseDrizzle(`
const timestamps = { createdAt: timestamp('created_at').notNull(), updatedAt: timestamp('updated_at') }
const base = { id: uuid('id').primaryKey(), ...timestamps } as const
export const notes = pgTable('notes', { ...base, body: text('body'), ...unknownHelper })
`)
    expect(Object.values(schema.tables.notes?.columns ?? {}).map((c) => c.name)).toEqual([
      'id',
      'created_at',
      'updated_at',
      'body',
    ])
  })

  it('follows a spread cycle and a self-spread once, and ignores spread calls', async () => {
    const schema = await parseDrizzle(`
const a = { aId: integer('a_id'), ...b }
const b = { bId: integer('b_id'), ...a }
const self = { selfId: integer('self_id'), ...self }
export const cycles = pgTable('cycles', { ...a, ...self, ...columnsOf(), id: integer('id') })
`)
    expect(Object.values(schema.tables.cycles?.columns ?? {}).map((c) => c.name)).toEqual([
      'a_id',
      'b_id',
      'self_id',
      'id',
    ])
  })

  it('expands an object literal declared after the table', async () => {
    const schema = await parseDrizzle(`
export const notes = pgTable('notes', { id: uuid('id').primaryKey(), ...audit })
const audit = { createdBy: text('created_by') }
`)
    expect(Object.values(schema.tables.notes?.columns ?? {}).map((c) => c.name)).toEqual([
      'id',
      'created_by',
    ])
  })

  it('expands a wide fan-out of spreads quickly', async () => {
    // Each level spreads the previous literal 10 times: 10^7 expansions if each spread were followed.
    const levels = 8
    const width = 10
    const literals = Array.from({ length: levels }, (_, level) =>
      level === 0
        ? `const l0 = { c0: integer('c0') }`
        : `const l${level} = { ${Array.from({ length: width }, () => `...l${level - 1}`).join(', ')}, c${level}: integer('c${level}') }`,
    )
    const source = `${literals.join('\n')}\nexport const wide = pgTable('wide', { ...l${levels - 1} })\n`
    // Parse something small first so the timing below leaves out the parser's start-up.
    await parseDrizzle(`export const warmup = pgTable('warmup', { id: integer('id') })`)
    const started = performance.now()
    const schema = await parseDrizzle(source)
    const elapsed = performance.now() - started
    expect(Object.values(schema.tables.wide?.columns ?? {}).map((c) => c.name)).toEqual(
      Array.from({ length: levels }, (_, level) => `c${level}`),
    )
    expect(elapsed).toBeLessThan(1000)
  })

  it('keys the tables of a pgSchema `schema.table` and points references at them', async () => {
    const schema = await parseDrizzle(`
export const users = pgTable('users', { id: uuid('id').primaryKey() })
export const auth = pgSchema('auth')
export const authUsers = auth.table('users', { id: uuid('id').primaryKey(), userId: uuid('user_id').references(() => users.id) }).enableRLS()
export const sessions = pgSchema('auth').table('sessions', { id: uuid('id').primaryKey(), userId: uuid('user_id').references(() => authUsers.id) })
`)
    expect(Object.keys(schema.tables).sort()).toEqual(['auth.sessions', 'auth.users', 'users'])
    expect(schema.tables['auth.users']).toMatchObject({ name: 'users', schemaName: 'auth' })
    expect(schema.tables.users?.schemaName).toBeNull()
    expect(schema.tables['auth.users']?.constraints.users_user_id_users_id_fk).toMatchObject({
      targetTableName: 'users',
    })
    expect(
      schema.tables['auth.sessions']?.constraints.sessions_user_id_authUsers_id_fk,
    ).toMatchObject({ targetTableName: 'auth.users' })
  })

  it('counts views instead of turning them into tables', async () => {
    const schema = await parseDrizzle(`
export const auth = pgSchema('auth')
export const users = pgTable('users', { id: uuid('id').primaryKey() })
export const active = pgView('active_users').as((qb) => qb.select().from(users))
export const stats = pgMaterializedView('user_stats').as((qb) => qb.select().from(users))
export const authActive = auth.view('active').as((qb) => qb.select().from(users))
`)
    expect(Object.keys(schema.tables)).toEqual(['users'])
    expect(schema.ignoredViews).toBe(3)
  })

  it('says whether a column name was explicit, and reads options given without a name', async () => {
    const schema = await parseDrizzle(`
export const people = pgTable('people', { id: integer('id').primaryKey(), firstName: text(), nick: varchar({ length: 40 }) })
`)
    const columns = schema.tables.people?.columns
    expect(columns?.id).toMatchObject({ name: 'id', nameExplicit: true })
    expect(columns?.firstName).toMatchObject({ name: 'firstName', nameExplicit: false })
    expect(columns?.nick).toMatchObject({ name: 'nick', type: 'varchar(40)', nameExplicit: false })
  })
})

const PRISMA = `generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema"]
}

datasource db {
  provider = "postgresql"
  url      = "postgresql://localhost/test"
  schemas  = ["auth", "public"]
}

model AuthUser {
  id       Int       @id @map("user_id")
  profiles Profile[]

  @@map("users")
  @@schema("auth")
}

model Profile {
  id     Int      @id
  authId Int      @map("auth_id")
  auth   AuthUser @relation(fields: [authId], references: [id])
  tags   Tag[]

  @@map("users")
  @@schema("public")
  @@index([authId])
}

model Tag {
  id       Int       @id @map("tag_id")
  profiles Profile[]

  @@schema("public")
}

model Variant {
  productId Int    @map("product_id")
  sku       String
  lines     Line[]

  @@id([productId, sku])
  @@schema("public")
}

model Line {
  id        Int     @id
  productId Int
  sku       String
  variant   Variant @relation(fields: [productId, sku], references: [productId, sku], onDelete: Cascade)

  @@schema("public")
}
`

describe('patched Liam — Prisma', () => {
  // Parsed once for the whole group (Prisma's validation is slow to start).
  let parsed: Promise<PatchedLiamSchema> | undefined
  const schemaOf = () => {
    parsed ??= parse(PRISMA, 'prisma').then((result) => {
      if (result.errors.length > 0) throw new Error(result.errors.map((e) => e.message).join('\n'))
      return result.value
    })
    return parsed
  }

  it('keys the tables of another schema `schema.table` and points relations at them', async () => {
    const schema = await schemaOf()
    expect(Object.keys(schema.tables).sort()).toEqual([
      'Line',
      'Tag',
      'Variant',
      '_ProfileToTag',
      'auth.users',
      'users',
    ])
    expect(schema.tables['auth.users']).toMatchObject({ name: 'users', schemaName: 'auth' })
    expect(schema.tables.users).toMatchObject({ name: 'users', schemaName: 'public' })
    expect(schema.tables.users?.constraints.AuthUserToProfile).toEqual({
      type: 'FOREIGN KEY',
      name: 'AuthUserToProfile',
      columnNames: ['auth_id'],
      targetTableName: 'auth.users',
      targetColumnNames: ['user_id'],
      updateConstraint: 'NO_ACTION',
      deleteConstraint: 'NO_ACTION',
    })
    expect(Object.keys(schema.tables.users?.indexes ?? {}).sort()).toEqual([
      'users_auth_id_idx',
      'users_pkey',
    ])
  })

  it('turns @@id([a, b]) into a composite primary key', async () => {
    const schema = await schemaOf()
    expect(schema.tables.Variant?.constraints.Variant_pkey).toEqual({
      type: 'PRIMARY KEY',
      name: 'Variant_pkey',
      columnNames: ['product_id', 'sku'],
    })
  })

  it('keeps every column of a composite relation', async () => {
    const schema = await schemaOf()
    expect(schema.tables.Line?.constraints.LineToVariant).toEqual({
      type: 'FOREIGN KEY',
      name: 'LineToVariant',
      columnNames: ['productId', 'sku'],
      targetTableName: 'Variant',
      targetColumnNames: ['product_id', 'sku'],
      updateConstraint: 'NO_ACTION',
      deleteConstraint: 'CASCADE',
    })
  })

  it('links the implicit many-to-many table to the tables of mapped models', async () => {
    const schema = await schemaOf()
    const join = schema.tables._ProfileToTag?.constraints
    expect(join?._ProfileToTag_A_fkey).toMatchObject({
      targetTableName: 'users',
      targetColumnNames: ['id'],
    })
    expect(join?._ProfileToTag_B_fkey).toMatchObject({
      targetTableName: 'Tag',
      targetColumnNames: ['tag_id'],
    })
  })
})

const PRISMA_MANY_TO_MANY = `generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema"]
}

datasource db {
  provider = "postgresql"
  url      = "postgresql://localhost/test"
  schemas  = ["auth", "public"]
}

model Post {
  id           Int   @id
  tags         Tag[] @relation("PostTags")
  featuredTags Tag[] @relation("FeaturedTags")

  @@schema("public")
}

model Tag {
  id         Int    @id
  posts      Post[] @relation("PostTags")
  featuredIn Post[] @relation("FeaturedTags")

  @@schema("public")
}

model Person {
  id        Int      @id
  followers Person[] @relation("follows")
  following Person[] @relation("follows")

  @@schema("public")
}

model Category {
  id       Int        @id
  parentId Int?
  parent   Category?  @relation("CategoryTree", fields: [parentId], references: [id])
  children Category[] @relation("CategoryTree")

  @@schema("public")
}

model Account {
  id   Int      @id
  keys APIKey[]

  @@schema("public")
}

model APIKey {
  id       String    @id
  accounts Account[]

  @@schema("auth")
}

model Membership {
  orgId  Int
  userId Int @map("user_id")

  @@id([orgId, userId], map: "memberships_pk")
  @@schema("public")
}
`

describe('patched Liam — Prisma implicit many-to-many tables and named keys', () => {
  // Parsed once for the whole group (Prisma's validation is slow to start).
  let parsed: Promise<PatchedLiamSchema> | undefined
  const schemaOf = () => {
    parsed ??= parse(PRISMA_MANY_TO_MANY, 'prisma').then((result) => {
      if (result.errors.length > 0) throw new Error(result.errors.map((e) => e.message).join('\n'))
      return result.value
    })
    return parsed
  }

  it('names a join table after its relation, one per relation between the same models', async () => {
    const schema = await schemaOf()
    expect(Object.keys(schema.tables).sort()).toEqual([
      'Account',
      'Category',
      'Membership',
      'Person',
      'Post',
      'Tag',
      '_FeaturedTags',
      '_PostTags',
      '_follows',
      'auth.APIKey',
      'auth._APIKeyToAccount',
    ])
    expect(schema.tables._PostTags?.constraints._PostTags_A_fkey).toMatchObject({
      targetTableName: 'Post',
      targetColumnNames: ['id'],
    })
    expect(schema.tables._PostTags?.constraints._PostTags_B_fkey).toMatchObject({
      targetTableName: 'Tag',
      targetColumnNames: ['id'],
    })
    expect(schema.tables._FeaturedTags?.constraints._FeaturedTags_A_fkey).toMatchObject({
      targetTableName: 'Post',
    })
  })

  it('links both columns of a self many-to-many table to its model', async () => {
    const schema = await schemaOf()
    const join = schema.tables._follows?.constraints
    expect(join?._follows_A_fkey).toMatchObject({ targetTableName: 'Person' })
    expect(join?._follows_B_fkey).toMatchObject({ targetTableName: 'Person' })
  })

  it('reads a one-to-many self-relation as a foreign key, not as a join table', async () => {
    const schema = await schemaOf()
    expect(schema.tables._CategoryTree).toBeUndefined()
    expect(schema.tables.Category?.constraints.CategoryTree).toMatchObject({
      type: 'FOREIGN KEY',
      columnNames: ['parentId'],
      targetTableName: 'Category',
      targetColumnNames: ['id'],
    })
  })

  it('orders the models of a join table by byte order and puts it in the schema of A', async () => {
    const schema = await schemaOf()
    const join = schema.tables['auth._APIKeyToAccount']
    expect(join).toMatchObject({ name: '_APIKeyToAccount', schemaName: 'auth' })
    expect(join?.columns.A?.type).toBe('text')
    expect(join?.columns.B?.type).toBe('integer')
    expect(join?.constraints._APIKeyToAccount_A_fkey).toMatchObject({
      targetTableName: 'auth.APIKey',
      targetColumnNames: ['id'],
    })
    expect(join?.constraints._APIKeyToAccount_B_fkey).toMatchObject({
      targetTableName: 'Account',
      targetColumnNames: ['id'],
    })
  })

  it('names a composite primary key after its map argument', async () => {
    const schema = await schemaOf()
    expect(schema.tables.Membership?.constraints).toMatchObject({
      memberships_pk: {
        type: 'PRIMARY KEY',
        name: 'memberships_pk',
        columnNames: ['orgId', 'user_id'],
      },
    })
    expect(schema.tables.Membership?.constraints.Membership_pkey).toBeUndefined()
  })
})
