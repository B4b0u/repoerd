import { describe, expect, it } from 'vitest'
import {
  decodeHiddenTables,
  encodeHiddenTables,
  sortedTableNames,
} from '../../src/features/diagram/model/compact-tables'

const names = Array.from({ length: 13 }, (_, i) => `t${String(i).padStart(2, '0')}`)

describe('compact table sets', () => {
  it('lists the hidden or the shown tables, whichever are fewer, in base-36 runs', () => {
    const hidden = new Set(names.filter((_, i) => i === 5 || i === 6 || i === 8))
    expect(encodeHiddenTables(names, hidden)).toMatch(/^h5-6\.8~[0-9a-z]+$/)
    const mostly = new Set(names.filter((_, i) => !(i <= 2 || i === 7 || i === 9 || i === 10)))
    expect(encodeHiddenTables(names, mostly)).toMatch(/^s0-2\.7\.9-a~[0-9a-z]+$/)
  })

  it('round-trips any set, the empty and the full ones included', () => {
    for (const hidden of [
      new Set<string>(),
      new Set(names),
      new Set(names.filter((_, i) => i % 2 === 0)),
      new Set(['t12']),
    ]) {
      expect(decodeHiddenTables(names, encodeHiddenTables(names, hidden))).toEqual(hidden)
    }
    expect(encodeHiddenTables(names, new Set(names))).toMatch(/^s~[0-9a-z]+$/)
  })

  it('does not depend on the order of the names it is given', () => {
    const hidden = new Set(['t03', 't04'])
    expect(encodeHiddenTables([...names].reverse(), hidden)).toBe(encodeHiddenTables(names, hidden))
    expect(sortedTableNames(['b', 'B', 'a', 'é'])).toEqual(['B', 'a', 'b', 'é'])
  })

  it('round-trips qualified names with dots and odd characters', () => {
    const odd = ['public.users', 'public.a.b', 'my schema.t-1', 'é.x']
    const hidden = new Set(['public.a.b'])
    expect(decodeHiddenTables(odd, encodeHiddenTables(odd, hidden))).toEqual(hidden)
  })

  it('ignores garbage, reversed runs and indices past the end, and refuses another kind', () => {
    const tag = encodeHiddenTables(names, new Set()).slice(1)
    expect(decodeHiddenTables(names, `h1.zz.c-1.!!.3-zzzzzz${tag}`)).toEqual(
      new Set(['t01', 't03', 't04', 't05', 't06', 't07', 't08', 't09', 't10', 't11', 't12']),
    )
    expect(decodeHiddenTables(names, `h${tag}`)).toEqual(new Set())
    expect(decodeHiddenTables(names, `x1-2${tag}`)).toBeNull()
    expect(decodeHiddenTables(names, '')).toBeNull()
    expect(decodeHiddenTables(names, 'h1-2')).toBeNull()
  })

  it('is ignored on another set of tables (another branch, a comparison)', () => {
    const encoded = encodeHiddenTables(names, new Set(['t01', 't02']))
    expect(decodeHiddenTables([...names, 'extra'], encoded)).toBeNull()
    expect(decodeHiddenTables(names.slice(1), encoded)).toBeNull()
    expect(decodeHiddenTables([...names].reverse(), encoded)).toEqual(new Set(['t01', 't02']))
  })
})
