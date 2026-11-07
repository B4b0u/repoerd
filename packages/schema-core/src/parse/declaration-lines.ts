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
    while (index < source.length && /\s/.test(source[index] as string)) index += 1
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

/**
 * The 0-based line declaring each table. SWC spans are 1-based UTF-8 byte positions that keep
 * accumulating across parses of one process, so they are rebased on the start of the module
 * (its first token) before being turned into a line.
 */
export function drizzleDeclarationLines(
  source: string,
  moduleSpanStart: number,
  spans: Record<string, number>,
): Record<string, number> {
  const bytes = Buffer.from(source)
  const base = moduleSpanStart - leadingTriviaBytes(source)
  const lines: Record<string, number> = {}
  for (const [key, span] of Object.entries(spans)) {
    const offset = Math.min(Math.max(span - base, 0), bytes.length)
    let line = 0
    for (let i = 0; i < offset; i += 1) if (bytes[i] === 0x0a) line += 1
    lines[key] = line
  }
  return lines
}
