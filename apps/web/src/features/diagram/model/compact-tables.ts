/** Past this many characters of `hidden`/`shown` parameters, the URL lists indices instead (`h`). */
export const MAX_TABLE_LIST_URL_LENGTH = 2000

const byCodePoints = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** The table names in code-point order: the order the indices of `h` refer to, on any browser. */
export const sortedTableNames = (names: readonly string[]) => [...names].sort(byCodePoints)

/** FNV-1a (32 bits, base 36) of the sorted names: tells a link made on another schema apart. */
function fingerprint(sorted: readonly string[]): string {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(sorted.join('\n'))) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

/** Indices as base-36 runs: [0, 1, 2, 4] → '0-2.4'. */
function runs(indices: readonly number[]): string {
  const parts: string[] = []
  let start = 0
  while (start < indices.length) {
    let end = start
    while (end + 1 < indices.length && indices[end + 1] === (indices[end] ?? 0) + 1) end++
    const first = (indices[start] ?? 0).toString(36)
    parts.push(end === start ? first : `${first}-${(indices[end] ?? 0).toString(36)}`)
    start = end + 1
  }
  return parts.join('.')
}

/**
 * The hidden tables among `names` as a short text: 'h' then the indices of the hidden tables, or
 * 's' then those of the shown ones, whichever lists fewer (indices into `sortedTableNames`).
 */
export function encodeHiddenTables(names: readonly string[], hidden: ReadonlySet<string>): string {
  const sorted = sortedTableNames(names)
  const hiddenCount = sorted.filter((name) => hidden.has(name)).length
  const listHidden = hiddenCount * 2 <= sorted.length
  const indices = sorted.flatMap((name, index) => (hidden.has(name) === listHidden ? [index] : []))
  return `${listHidden ? 'h' : 's'}${runs(indices)}~${fingerprint(sorted)}`
}

/**
 * The hidden tables a text of `encodeHiddenTables` names among `names`; null when it is not one or
 * was made on another set of names (fingerprint mismatch: the indices would mean other tables).
 * Malformed parts and indices past the end are ignored.
 */
export function decodeHiddenTables(names: readonly string[], encoded: string): Set<string> | null {
  const kind = encoded[0]
  if (kind !== 'h' && kind !== 's') return null
  const sorted = sortedTableNames(names)
  const tilde = encoded.lastIndexOf('~')
  if (tilde < 0 || encoded.slice(tilde + 1) !== fingerprint(sorted)) return null
  const listed = new Set<number>()
  for (const part of encoded.slice(1, tilde).split('.')) {
    const match = /^([0-9a-z]+)(?:-([0-9a-z]+))?$/.exec(part)
    if (!match) continue
    const first = Number.parseInt(match[1] ?? '', 36)
    const last = match[2] === undefined ? first : Number.parseInt(match[2], 36)
    for (let index = first; index <= Math.min(last, sorted.length - 1); index++) listed.add(index)
  }
  return new Set(sorted.filter((_, index) => listed.has(index) === (kind === 'h')))
}
