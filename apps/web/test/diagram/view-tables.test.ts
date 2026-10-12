import type { DbSchema } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import {
  decodeHiddenTables,
  MAX_TABLE_LIST_URL_LENGTH,
} from '../../src/features/diagram/model/compact-tables'
import {
  hiddenPatch,
  resolveViewTables,
  revealPatch,
} from '../../src/features/diagram/model/view-tables'

const schema = {
  tables: {
    users: {
      name: 'users',
      schema: null,
      comment: null,
      columns: [],
      indexes: [],
      constraints: [],
    },
    posts: {
      name: 'posts',
      schema: null,
      comment: null,
      columns: [],
      indexes: [],
      constraints: [],
    },
    tags: { name: 'tags', schema: null, comment: null, columns: [], indexes: [], constraints: [] },
  },
  enums: {},
  relationships: [],
} satisfies DbSchema

describe('resolveViewTables', () => {
  it('keeps tables that exist on this branch', () => {
    expect(
      resolveViewTables(schema, { active: 'users', focus: 'posts', hidden: ['posts'] }),
    ).toEqual({
      active: 'users',
      focus: 'posts',
      hidden: new Set(['posts']),
    })
  })

  it('drops names of Object members, which are no tables', () => {
    expect(
      resolveViewTables(schema, {
        active: 'constructor',
        focus: 'toString',
        hidden: ['__proto__', 'hasOwnProperty', 'users'],
      }),
    ).toEqual({ active: undefined, focus: undefined, hidden: new Set(['users']) })
  })

  it('drops tables that do not exist (stale links, other branches)', () => {
    expect(
      resolveViewTables(schema, { active: 'ghost', focus: 'gone', hidden: ['users', 'nope'] }),
    ).toEqual({ active: undefined, focus: undefined, hidden: new Set(['users']) })
  })

  it('hides every table not listed when the URL lists the shown ones instead', () => {
    expect(resolveViewTables(schema, { hidden: [], shown: ['posts', 'ghost'] }).hidden).toEqual(
      new Set(['users', 'tags']),
    )
    expect(resolveViewTables(schema, { hidden: [], shown: [] }).hidden).toEqual(
      new Set(['users', 'posts', 'tags']),
    )
  })
})

describe('hiddenPatch', () => {
  const names = ['users', 'posts', 'tags']

  it('lists the hidden tables while they are at most half of the schema', () => {
    expect(hiddenPatch(names, new Set(['posts']))).toEqual({ hidden: ['posts'], shown: undefined })
  })

  it('lists the shown tables instead once most tables are hidden, so URLs stay short', () => {
    expect(hiddenPatch(names, new Set(['users', 'posts']))).toEqual({ hidden: [], shown: ['tags'] })
    expect(hiddenPatch(names, new Set(names))).toEqual({ hidden: [], shown: [] })
  })

  it('round-trips through resolveViewTables', () => {
    for (const hidden of [[], ['tags'], ['users', 'tags'], names]) {
      const patch = hiddenPatch(names, new Set(hidden))
      expect(resolveViewTables(schema, patch).hidden).toEqual(new Set(hidden))
    }
  })
})

describe('revealPatch', () => {
  it('un-hides one table in either encoding', () => {
    const names = ['users', 'posts', 'tags']
    expect(revealPatch(names, new Set(['users', 'posts']), 'posts')).toEqual({
      hidden: ['users'],
      shown: undefined,
    })
    expect(revealPatch(names, new Set(names), 'tags')).toEqual({ hidden: [], shown: ['tags'] })
  })
})

describe('hiddenPatch on very large schemas', () => {
  const many = Array.from({ length: 600 }, (_, i) => `a_table_with_a_rather_long_name_${i}`)
  const big: DbSchema = {
    tables: Object.fromEntries(
      many.map((name) => [
        name,
        { name, schema: null, comment: null, columns: [], indexes: [], constraints: [] },
      ]),
    ),
    enums: {},
    relationships: [],
  }

  it('switches to the compact parameter past 2,000 characters, and reads it back', () => {
    expect(MAX_TABLE_LIST_URL_LENGTH).toBe(2000)
    const hidden = new Set(many.filter((_, i) => i % 3 === 0))
    const patch = hiddenPatch(many, hidden)
    expect(patch.hidden).toEqual([])
    expect(patch.shown).toBeUndefined()
    expect(patch.compact?.startsWith('h')).toBe(true)
    expect(decodeHiddenTables(many, patch.compact ?? '')).toEqual(hidden)
    expect(resolveViewTables(big, patch).hidden).toEqual(hidden)
  })

  it('hides nothing when the compact parameter was made on another set of tables', () => {
    const patch = hiddenPatch(many, new Set(many.filter((_, i) => i % 3 === 0)))
    const comparison: DbSchema = {
      ...big,
      tables: { ...big.tables, extra: { ...big.tables[many[0] ?? ''], name: 'extra' } as never },
    }
    expect(resolveViewTables(comparison, patch).hidden).toEqual(new Set())
  })

  it('keeps the plain parameters below the limit, and still reads them', () => {
    const patch = hiddenPatch(many, new Set(many.slice(0, 5)))
    expect(patch).toEqual({ hidden: many.slice(0, 5), shown: undefined, compact: undefined })
    expect(resolveViewTables(big, { hidden: many.slice(0, 5) }).hidden).toEqual(
      new Set(many.slice(0, 5)),
    )
  })

  it('falls back to the plain parameters when the compact one is not readable', () => {
    expect(resolveViewTables(big, { hidden: [many[1] ?? ''], compact: 'x!' }).hidden).toEqual(
      new Set([many[1]]),
    )
  })

  it('ignores a compact list made against a larger schema, without crashing', () => {
    const small = { ...big, tables: { [many[0] ?? '']: big.tables[many[0] ?? ''] } } as DbSchema
    expect(resolveViewTables(small, { hidden: [], compact: 'h0.5-zz~abc' }).hidden.size).toBe(0)
  })
})
