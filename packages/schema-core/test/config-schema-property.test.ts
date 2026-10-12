import { describe, expect, it } from 'vitest'
import { readConfigSchemaProperty } from '../src/detect/config-schema-property.js'

describe('readConfigSchemaProperty', () => {
  it('reads a string passed to defineConfig', () => {
    const source = `
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './src/infrastructure/database/migrations',
  schema: './src/infrastructure/database/schemas/**/*.schema.ts',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
`
    expect(readConfigSchemaProperty(source)).toEqual({
      ok: true,
      paths: ['./src/infrastructure/database/schemas/**/*.schema.ts'],
      dialect: 'postgresql',
    })
  })

  it('reads an array of paths', () => {
    const source = `export default defineConfig({ schema: ['./src/a.ts', "./src/b.ts"] })`
    expect(readConfigSchemaProperty(source)).toEqual({
      ok: true,
      paths: ['./src/a.ts', './src/b.ts'],
    })
  })

  it('follows a top-level identifier wrapped in satisfies', () => {
    const source = `
import type { Config } from 'drizzle-kit'
const config = { schema: './db/schema.ts', dialect: 'postgresql' } satisfies Config
export default config
`
    expect(readConfigSchemaProperty(source)).toEqual({
      ok: true,
      paths: ['./db/schema.ts'],
      dialect: 'postgresql',
    })
  })

  it('follows an exported const and a plain object export', () => {
    expect(
      readConfigSchemaProperty(`export const c = { schema: 'x.ts' } as const\nexport default c`),
    ).toEqual({ ok: true, paths: ['x.ts'] })
    expect(readConfigSchemaProperty(`export default { "schema": \`./y.ts\` }`)).toEqual({
      ok: true,
      paths: ['./y.ts'],
    })
  })

  it('refuses computed values instead of executing them', () => {
    const source = `
import path from 'node:path'
export default defineConfig({ schema: path.join(__dirname, 'schema.ts') })
`
    expect(readConfigSchemaProperty(source)).toEqual({ ok: false })
  })

  it('returns not ok for syntax errors, missing schema or missing default export', () => {
    expect(readConfigSchemaProperty('export default defineConfig({')).toEqual({ ok: false })
    expect(readConfigSchemaProperty(`export default defineConfig({ out: './x' })`)).toEqual({
      ok: false,
      missing: true,
    })
    expect(readConfigSchemaProperty(`export const schema = './x.ts'`)).toEqual({ ok: false })
  })

  it.each([
    ['CommonJS export', `module.exports = { schema: './src/schema.ts' }`, ['./src/schema.ts']],
    [
      'CommonJS defineConfig',
      `const { defineConfig } = require('drizzle-kit')\nmodule.exports = defineConfig({ schema: './s.ts' })`,
      ['./s.ts'],
    ],
    [
      'shorthand property',
      `const schema = './src/db/*.ts'\nexport default defineConfig({ schema })`,
      ['./src/db/*.ts'],
    ],
    [
      'export { x as default }',
      `const config = { schema: ['./a.ts', './b.ts'] }\nexport { config as default }`,
      ['./a.ts', './b.ts'],
    ],
    [
      'constant value',
      `const SCHEMA = './src/schema'\nexport default { schema: SCHEMA }`,
      ['./src/schema'],
    ],
    [
      'constant array',
      `const FILES = ['./a.ts'] as const\nexport default { schema: FILES }`,
      ['./a.ts'],
    ],
  ])('reads %s', (_label, source, paths) => {
    expect(readConfigSchemaProperty(source)).toEqual({ ok: true, paths })
  })

  it('still refuses what it cannot know statically', () => {
    expect(readConfigSchemaProperty(`export default { schema: process.env.SCHEMA }`)).toEqual({
      ok: false,
    })
    expect(readConfigSchemaProperty(`module.exports = makeConfig()`)).toEqual({ ok: false })
  })

  it('does not loop on circular constants', () => {
    expect(
      readConfigSchemaProperty(`const a = b\nconst b = a\nexport default { schema: a }`),
    ).toEqual({ ok: false })
  })

  it('reads the dialect and the casing, also through constants', () => {
    expect(
      readConfigSchemaProperty(
        `const DIALECT = 'mysql'
export default defineConfig({ dialect: DIALECT, casing: 'snake_case', schema: './db.ts' })`,
      ),
    ).toEqual({ ok: true, paths: ['./db.ts'], dialect: 'mysql', casing: 'snake_case' })
  })

  it('keeps the dialect when the schema cannot be read', () => {
    expect(
      readConfigSchemaProperty(
        `export default defineConfig({ dialect: 'sqlite', schema: path.join(__dirname, 'db.ts') })`,
      ),
    ).toEqual({ ok: false, dialect: 'sqlite' })
  })

  it('ignores options computed at runtime', () => {
    expect(
      readConfigSchemaProperty(
        `export default { dialect: process.env.DIALECT, casing: pick(), schema: './db.ts' }`,
      ),
    ).toEqual({ ok: true, paths: ['./db.ts'] })
  })
})
