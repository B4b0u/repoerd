/**
 * Number of UTF-8 bytes before the first token of a source: BOM, whitespace, `//` and block
 * comments, and a leading `#!` line. SWC's module span starts at that first token.
 */
export function leadingTriviaBytes(source: string): number {
  let index = 0
  if (source.startsWith('\uFEFF')) index = 1
  if (source.startsWith('#!', index)) {
    const end = source.indexOf('\n', index)
    index = end === -1 ? source.length : end
  }
  for (;;) {
    while (index < source.length && /\s/.test(source.charAt(index))) index += 1
    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index)
      index = end === -1 ? source.length : end
    } else if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2)
      index = end === -1 ? source.length : end + 2
    } else {
      break
    }
  }
  return Buffer.byteLength(source.slice(0, index))
}

/** Index of the first element of the ascending `values` that is >= `target` (`values.length` if none). */
function lowerBound(values: readonly number[], target: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((values[middle] as number) < target) low = middle + 1
    else high = middle
  }
  return low
}

/**
 * The 0-based line declaring each table. SWC spans are 1-based UTF-8 byte positions that keep
 * accumulating across parses of one process, so they are rebased on the start of the module
 * (its first token) before being turned into a line. The newline offsets are collected once and
 * searched for each table.
 */
export function drizzleDeclarationLines(
  source: string,
  moduleSpanStart: number,
  spans: Record<string, number>,
): Record<string, number> {
  const bytes = Buffer.from(source)
  const base = moduleSpanStart - leadingTriviaBytes(source)
  const newlines: number[] = []
  for (let index = bytes.indexOf(0x0a); index !== -1; index = bytes.indexOf(0x0a, index + 1)) {
    newlines.push(index)
  }
  // Own-property entries: a table keyed `__proto__` must stay a key, not set a prototype.
  return Object.fromEntries(
    Object.entries(spans).map(([key, span]) => {
      const offset = Math.min(Math.max(span - base, 0), bytes.length)
      // Newlines at an index < offset precede the offset.
      return [key, lowerBound(newlines, offset)]
    }),
  )
}
