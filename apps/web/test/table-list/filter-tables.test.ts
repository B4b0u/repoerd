import { describe, expect, it } from 'vitest'
import { filterTables } from '../../src/features/table-list/filter-tables'

const names = ['order_items', 'orders', 'Products', 'users']

describe('filterTables', () => {
  it('returns every table for an empty or blank query', () => {
    expect(filterTables(names, '')).toEqual(names)
    expect(filterTables(names, '  ')).toEqual(names)
  })

  it('matches case-insensitively anywhere in the name', () => {
    expect(filterTables(names, 'ORDER')).toEqual(['order_items', 'orders'])
    expect(filterTables(names, 'duct')).toEqual(['Products'])
    expect(filterTables(names, 'zzz')).toEqual([])
  })
})
