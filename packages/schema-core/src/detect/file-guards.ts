import type { SourceProblem } from '@repoerd/model'

/** Largest file detection reads (configs, package.json files, followed modules): 256 KiB. */
export const MAX_FILE_BYTES = 256 * 1024
/** Deepest bracket nesting handed to the parser: deeper input can overflow its native stack. */
export const MAX_NESTING = 500
/** Drizzle configs read in one tree; the others are reported, not read. */
export const MAX_DRIZZLE_CONFIGS = 50
/** Prisma configs (prisma.config, package.json) read in one tree; the others are reported. */
export const MAX_PRISMA_CONFIGS = 50

const OPENERS = new Set(['(', '[', '{'])
const CLOSERS = new Set([')', ']', '}'])
/** Marks a `${` on the stack: its `}` goes back inside the template literal. */
const TEMPLATE = '`'

/**
 * How deep parentheses, brackets and braces nest, outside strings and comments, in one linear
 * pass. A heuristic for JavaScript-like text (regular expression literals are read as code):
 * it never throws and never recurses.
 */
export function nestingDepth(source: string): number {
  const stack: string[] = []
  let deepest = 0
  let i = 0

  const open = (marker: string) => {
    stack.push(marker)
    deepest = Math.max(deepest, stack.length)
  }
  /** From just after an opening backtick or a `}` closing `${`: to the end of the template. */
  const skipTemplate = () => {
    while (i < source.length) {
      const char = source[i]
      if (char === '\\') {
        i += 2
      } else if (char === '`') {
        i += 1
        return
      } else if (char === '$' && source[i + 1] === '{') {
        i += 2
        open(TEMPLATE)
        return
      } else {
        i += 1
      }
    }
  }

  while (i < source.length) {
    const char = source[i] ?? ''
    const next = source[i + 1]
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      i = end === -1 ? source.length : end + 1
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
    } else if (char === '"' || char === "'") {
      // A string ends at its quote or, unterminated, at the end of the line.
      i += 1
      while (i < source.length && source[i] !== char && source[i] !== '\n') {
        i += source[i] === '\\' ? 2 : 1
      }
      i += 1
    } else if (char === '`') {
      i += 1
      skipTemplate()
    } else if (OPENERS.has(char)) {
      open(char)
      i += 1
    } else if (CLOSERS.has(char)) {
      const closed = stack.pop()
      i += 1
      if (closed === TEMPLATE) skipTemplate()
    } else {
      i += 1
    }
  }
  return deepest
}

/** Whether the parser may be given this text. */
export const withinNesting = (source: string) => nestingDepth(source) <= MAX_NESTING

export const fileTooComplex = (path: string): SourceProblem => ({ kind: 'file-too-complex', path })
