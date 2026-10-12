import type { DbSchema } from '@repoerd/model'
import type { ViewState } from '../view-state'
import { decodeHiddenTables, encodeHiddenTables, MAX_TABLE_LIST_URL_LENGTH } from './compact-tables'

export interface ViewTables {
  active?: string
  focus?: string
  hidden: ReadonlySet<string>
}

/**
 * Keeps only the URL's table names that exist in this schema (old links, other branches). Own
 * keys only: `?active=constructor` names no table.
 */
export function resolveViewTables(
  schema: DbSchema,
  state: Pick<ViewState, 'active' | 'focus' | 'hidden' | 'shown' | 'compact'>,
): ViewTables {
  const exists = (table: string) => Object.hasOwn(schema.tables, table)
  const known = (table: string | undefined) =>
    table !== undefined && exists(table) ? table : undefined
  const compact =
    state.compact === undefined
      ? null
      : decodeHiddenTables(Object.keys(schema.tables), state.compact)
  const shown = state.shown && new Set(state.shown)
  return {
    active: known(state.active),
    focus: known(state.focus),
    hidden:
      compact ??
      new Set(
        shown
          ? Object.keys(schema.tables).filter((table) => !shown.has(table))
          : state.hidden.filter(exists),
      ),
  }
}

export type HiddenPatch = Pick<ViewState, 'hidden' | 'shown' | 'compact'>

/**
 * Encodes the hidden tables with whichever list is shorter, to keep shared links short; past
 * MAX_TABLE_LIST_URL_LENGTH characters of parameters, as table indices (`h`, spec §6.6).
 */
export function hiddenPatch(names: readonly string[], hidden: ReadonlySet<string>): HiddenPatch {
  const listHidden = hidden.size * 2 <= names.length
  const list = names.filter((name) => hidden.has(name) === listHidden)
  // Each entry is `&hidden=<name>` or `&shown=<name>`, the name URI-encoded.
  const key = listHidden ? 'hidden' : 'shown'
  const length = list.reduce(
    (sum, name) => sum + key.length + 2 + encodeURIComponent(name).length,
    0,
  )
  if (length > MAX_TABLE_LIST_URL_LENGTH)
    return { hidden: [], shown: undefined, compact: encodeHiddenTables(names, hidden) }
  return listHidden
    ? { hidden: list, shown: undefined, compact: undefined }
    : { hidden: [], shown: list, compact: undefined }
}

export function revealPatch(
  names: readonly string[],
  hidden: ReadonlySet<string>,
  table: string,
): HiddenPatch {
  return hiddenPatch(names, new Set([...hidden].filter((name) => name !== table)))
}
