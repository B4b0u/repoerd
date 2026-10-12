import {
  type DisplayMode,
  isDisplayMode,
  type SchemaFormat,
  type TablePosition,
} from '@repoerd/model'
import { err, ok, type Result } from './result.js'

export const MAX_TABLE_POSITIONS = 5000
export const MAX_TABLE_NAME_LENGTH = 256
export const MAX_SOURCE_ID_LENGTH = 512
/** Saved layouts (source × display mode) per user and repository. */
export const MAX_LAYOUTS_PER_REPO = 50

export type LayoutError =
  | { kind: 'invalid-positions'; reason: string }
  | { kind: 'invalid-source' }
  | { kind: 'invalid-mode' }
  | { kind: 'too-many-layouts'; max: number }

export function validateDisplayMode(mode: string): Result<DisplayMode, LayoutError> {
  return isDisplayMode(mode) ? ok(mode) : err({ kind: 'invalid-mode' })
}

export function validateSourceId(sourceId: string): Result<string, LayoutError> {
  return sourceId.length > 0 && sourceId.length <= MAX_SOURCE_ID_LENGTH
    ? ok(sourceId)
    : err({ kind: 'invalid-source' })
}

export function normalizePositions(
  positions: readonly TablePosition[],
): Result<TablePosition[], LayoutError> {
  if (positions.length > MAX_TABLE_POSITIONS) {
    return err({ kind: 'invalid-positions', reason: `At most ${MAX_TABLE_POSITIONS} positions` })
  }
  const byTable = new Map<string, TablePosition>()
  for (const position of positions) {
    if (position.table.length === 0) {
      return err({ kind: 'invalid-positions', reason: 'Table name must not be empty' })
    }
    if (position.table.length > MAX_TABLE_NAME_LENGTH) {
      return err({
        kind: 'invalid-positions',
        reason: `Table names are limited to ${MAX_TABLE_NAME_LENGTH} characters`,
      })
    }
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      return err({ kind: 'invalid-positions', reason: `Invalid coordinates for ${position.table}` })
    }
    byTable.set(position.table, { table: position.table, x: position.x, y: position.y })
  }
  return ok([...byTable.values()])
}

const DRIZZLE_CONFIG = /(^|\/)drizzle\.config\.(ts|mts|cts|js|mjs|cjs)$/

/**
 * The format of an automatically detected source, read from its id (its path): a drizzle.config
 * file is Drizzle, any other path (a .prisma file, a folder of them, a prisma.config) is Prisma.
 * A manual source (`manual:<name>`) does not say: null.
 */
export function sourceIdFormat(sourceId: string): SchemaFormat | null {
  if (sourceId.startsWith('manual:')) return null
  return DRIZZLE_CONFIG.test(sourceId) ? 'drizzle' : 'prisma'
}
