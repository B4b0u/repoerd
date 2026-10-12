import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ENTITY_COUNT = 100
const repoDir = fileURLToPath(new URL('../fixtures/repos/acme/platform-monorepo', import.meta.url))
const snapshotDir = path.join(repoDir, 'main')
const db = 'packages/core/src/infrastructure/database'
const pad = (n: number) => String(n).padStart(3, '0')
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
const lines = (...rows: string[]) => `${rows.join('\n')}\n`

function entitySource(i: number): string {
  const name = `entity${pad(i)}`
  // Entities form a tree (up to 5 children each), like real schemas, rather than a long chain.
  const parentIndex = i > 1 ? Math.floor((i - 2) / 5) + 1 : null
  const previous = parentIndex === null ? null : `entity${pad(parentIndex)}`
  const imports = [
    "import { pgTable, text, uuid } from 'drizzle-orm/pg-core';",
    "import { auditColumns } from '../columns';",
    "import { organizations } from './drizzle-organization.schema';",
    "import { recordStatus } from './drizzle-shared.schema';",
  ]
  if (previous && parentIndex !== null) {
    imports.push(`import { ${previous} } from './drizzle-entity-${pad(parentIndex)}.schema';`)
  }
  const columns = [
    "  id: uuid('id').primaryKey().defaultRandom(),",
    "  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),",
  ]
  if (previous) columns.push(`  parentId: uuid('parent_id').references(() => ${previous}.id),`)
  columns.push(
    "  label: text('label').notNull(),",
    "  status: recordStatus('status').notNull(),",
    '  ...auditColumns,',
  )
  return lines(
    ...imports,
    '',
    `export const ${name} = pgTable('entity_${pad(i)}', {`,
    ...columns,
    '});',
  )
}

const files: Record<string, string> = {
  'package.json': json({ name: 'platform', private: true, workspaces: ['packages/*'] }),
  'packages/core/package.json': json({ name: '@platform/core', private: true }),
  [`${db}/drizzle.config.ts`]: lines(
    "import 'dotenv/config';",
    '',
    "import { defineConfig } from 'drizzle-kit';",
    '',
    'export default defineConfig({',
    "  out: './src/infrastructure/database/migrations',",
    "  schema: './src/infrastructure/database/schemas/**/*.schema.ts',",
    "  dialect: 'postgresql',",
    '  dbCredentials: {',
    "    url: process.env.DATABASE_URL ?? '',",
    '  },',
    '});',
  ),
  [`${db}/columns.ts`]: lines(
    "import { timestamp } from 'drizzle-orm/pg-core';",
    '',
    'export const auditColumns = {',
    "  createdAt: timestamp('created_at').notNull().defaultNow(),",
    "  updatedAt: timestamp('updated_at').notNull().defaultNow(),",
    '};',
  ),
  [`${db}/naming.ts`]: lines(
    'export const tableLabel = (name: string): string => name.toLowerCase();',
  ),
  [`${db}/schemas/drizzle-shared.schema.ts`]: lines(
    "import { pgEnum } from 'drizzle-orm/pg-core';",
    '',
    "export const recordStatus = pgEnum('record_status', ['active', 'archived']);",
  ),
  [`${db}/schemas/drizzle-organization.schema.ts`]: lines(
    "import { pgTable, text, uuid } from 'drizzle-orm/pg-core';",
    "import { auditColumns } from '../columns';",
    '',
    "export const organizations = pgTable('organizations', {",
    "  id: uuid('id').primaryKey().defaultRandom(),",
    "  name: text('name').notNull(),",
    '  ...auditColumns,',
    '});',
  ),
  [`${db}/schemas/drizzle-user.schema.ts`]: lines(
    "import { pgTable, text, uuid } from 'drizzle-orm/pg-core';",
    "import { auditColumns } from '../columns';",
    "import { tableLabel } from '../naming';",
    "import { organizations } from './drizzle-organization.schema';",
    '',
    "export const usersLabel = tableLabel('Users');",
    '',
    "export const users = pgTable('users', {",
    "  id: uuid('id').primaryKey().defaultRandom(),",
    "  organizationId: uuid('organization_id').notNull().references(() => organizations.id),",
    "  email: text('email').notNull().unique(),",
    '  ...auditColumns,',
    '});',
  ),
  [`${db}/schemas/drizzle-entity-001.schema.test.ts`]: lines(
    "import { entity001 } from './drizzle-entity-001.schema';",
    '',
    'export const sample = entity001;',
  ),
}
for (let i = 1; i <= ENTITY_COUNT; i++) {
  files[`${db}/schemas/drizzle-entity-${pad(i)}.schema.ts`] = entitySource(i)
}

rmSync(repoDir, { recursive: true, force: true })
for (const [relative, content] of Object.entries(files)) {
  const full = path.join(snapshotDir, relative)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content)
}
writeFileSync(
  path.join(repoDir, 'repo.json'),
  json({ defaultBranch: 'main', branches: { main: 'main' } }),
)
console.log(`Wrote ${Object.keys(files).length} files to ${snapshotDir}`)
