import type { Schema as LiamSchema } from '@liam-hq/schema'
import { describe, expect, it } from 'vitest'
import { toDbSchema } from '../src/parse/liam-to-model.js'

const liamTable = (name: string) => ({
  name,
  comment: null,
  columns: {
    id: { name: 'id', type: 'uuid', default: null, check: null, notNull: true, comment: null },
  },
  indexes: {},
  constraints: {},
})

describe('toDbSchema', () => {
  it('keeps tables and enums named like Object members as ordinary entries', () => {
    // JSON.parse creates own "__proto__" keys, as a parser may.
    const tables = JSON.parse(
      `{"__proto__": ${JSON.stringify(liamTable('__proto__'))}, "constructor": ${JSON.stringify(liamTable('constructor'))}}`,
    ) as LiamSchema['tables']
    const enums = JSON.parse(
      '{"__proto__": {"name": "__proto__", "values": ["a"], "comment": null}}',
    ) as LiamSchema['enums']

    const schema = toDbSchema({ tables, enums, extensions: {} })

    expect(Object.keys(schema.tables).sort()).toEqual(['__proto__', 'constructor'])
    expect(Object.getPrototypeOf(schema.tables)).toBe(Object.prototype)
    expect(Object.hasOwn(schema.tables, '__proto__')).toBe(true)
    expect(Object.keys(schema.enums)).toEqual(['__proto__'])
  })

  it('names a table outside public `schema.table`, and a public one by its name', () => {
    const tables = {
      users: { ...liamTable('users'), schemaName: 'public' },
      'audit.events': { ...liamTable('events'), schemaName: 'audit' },
    }
    const schema = toDbSchema({ tables, enums: {}, extensions: {} })

    expect(Object.keys(schema.tables)).toEqual(['users', 'audit.events'])
    expect(schema.tables.users).toMatchObject({ name: 'users', schema: null })
    expect(schema.tables['audit.events']).toMatchObject({ name: 'audit.events', schema: 'audit' })
  })

  it('reports the views of the source, and nothing when there is none', () => {
    expect(
      toDbSchema({ tables: {}, enums: {}, extensions: {}, ignoredViews: 2 }).ignoredViews,
    ).toBe(2)
    expect(toDbSchema({ tables: {}, enums: {}, extensions: {} })).not.toHaveProperty('ignoredViews')
  })
})
