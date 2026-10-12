import type { DbSchema, DisplayMode, TablePosition } from '@repoerd/model'
import { type Point, TABLE_WIDTH, tableSize } from '../model/dimensions'
import { layoutTables } from './auto-layout'

export const NEW_TABLES_GAP = 200

export interface Placement {
  positions: Map<string, Point>
  added: TablePosition[]
}

export async function placeTables(
  schema: DbSchema,
  saved: readonly TablePosition[],
  mode: DisplayMode = 'ALL_FIELDS',
): Promise<Placement> {
  const savedByTable = new Map(saved.map((p) => [p.table, { x: p.x, y: p.y }]))
  const positions = new Map<string, Point>()
  const missing: string[] = []
  for (const name of Object.keys(schema.tables)) {
    const position = savedByTable.get(name)
    if (position) positions.set(name, position)
    else missing.push(name)
  }
  if (missing.length === 0) return { positions, added: [] }

  const laidOut = await layoutTables(schema, missing, mode)
  const origin = positions.size === 0 ? { x: 0, y: 0 } : rightOfExisting(schema, positions)
  const minX = Math.min(...[...laidOut.values()].map((p) => p.x))
  const minY = Math.min(...[...laidOut.values()].map((p) => p.y))

  const added: TablePosition[] = []
  for (const name of missing) {
    const p = laidOut.get(name) ?? { x: minX, y: minY }
    const placed = { x: Math.round(p.x - minX + origin.x), y: Math.round(p.y - minY + origin.y) }
    positions.set(name, placed)
    added.push({ table: name, ...placed })
  }
  return { positions, added }
}

function rightOfExisting(schema: DbSchema, positions: Map<string, Point>): Point {
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  for (const [name, p] of positions) {
    const table = schema.tables[name]
    const width = table ? tableSize(table).width : TABLE_WIDTH
    right = Math.max(right, p.x + width)
    top = Math.min(top, p.y)
  }
  return { x: right + NEW_TABLES_GAP, y: top }
}
