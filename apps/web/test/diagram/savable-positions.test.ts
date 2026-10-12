import { type DbSchema, diffSchemas, type Table } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import { savablePositions } from '../../src/features/diagram/layout/savable-positions'

const table = (name: string): Table => ({
  name,
  schema: null,
  comment: null,
  columns: [],
  indexes: [],
  constraints: [],
})
const schemaOf = (...names: string[]): DbSchema => ({
  tables: Object.fromEntries(names.map((name) => [name, table(name)])),
  enums: {},
  relationships: [],
})
const positions = [
  { table: 'users', x: 0, y: 0 },
  { table: 'legacy', x: 1, y: 1 },
  { table: 'reviews', x: 2, y: 2 },
]

describe('savablePositions', () => {
  it('keeps every position outside a comparison', () => {
    expect(savablePositions(positions, undefined)).toEqual(positions)
  })

  it('drops the tables of the reference side only in a comparison', () => {
    const diff = diffSchemas(schemaOf('users', 'legacy'), schemaOf('users', 'reviews'))
    expect(savablePositions(positions, diff).map((p) => p.table)).toEqual(['users', 'reviews'])
  })
})
