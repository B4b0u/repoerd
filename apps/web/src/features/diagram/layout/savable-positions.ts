import type { SchemaDiff, TablePosition } from '@repoerd/model'

/**
 * The positions a canvas may save. In a comparison (`diff`), the tables of the reference side
 * only are placed but never saved: they are not tables of the displayed branch (spec §6.2).
 */
export function savablePositions(
  positions: readonly TablePosition[],
  diff: SchemaDiff | undefined,
): TablePosition[] {
  if (!diff) return [...positions]
  return positions.filter(
    ({ table }) => !(Object.hasOwn(diff.tables, table) && diff.tables[table]?.status === 'removed'),
  )
}
