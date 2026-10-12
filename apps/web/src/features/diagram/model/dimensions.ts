import type { DisplayMode, Table } from '@repoerd/model'
import { visibleColumns } from './display-mode'

export const TABLE_WIDTH = 280
export const HEADER_HEIGHT = 40
export const ROW_HEIGHT = 28
export const TABLE_NAME_HEIGHT = 52
const BOTTOM_PADDING = 8

export interface Point {
  x: number
  y: number
}

export function tableSize(
  table: Table,
  mode: DisplayMode = 'ALL_FIELDS',
): { width: number; height: number } {
  if (mode === 'TABLE_NAME') return { width: TABLE_WIDTH, height: TABLE_NAME_HEIGHT }
  const rows = visibleColumns(table, mode).length
  return {
    width: TABLE_WIDTH,
    height: HEADER_HEIGHT + rows * ROW_HEIGHT + (rows > 0 ? BOTTOM_PADDING : 0),
  }
}
