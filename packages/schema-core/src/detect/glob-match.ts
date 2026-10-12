import picomatch from 'picomatch'

// Patterns come from repository content: no brace/extglob expansion, no negation.
export const GLOB_OPTIONS = { dot: true, noextglob: true, nobrace: true, nonegate: true }

/**
 * Matches a path against a glob one '/' segment at a time ('**' = any number of segments):
 * the cost stays (pattern segments x path segments) x one segment match, whatever the input.
 */
export function compileGlob(pattern: string): (path: string) => boolean {
  const parts = pattern.split('/')
  const segment = parts.map((part) => (part === '**' ? null : picomatch(part, GLOB_OPTIONS)))
  return (path) => {
    const names = path.split('/')
    const memo = new Map<number, boolean>()
    const match = (i: number, j: number): boolean => {
      if (i === parts.length) return j === names.length
      const key = i * (names.length + 1) + j
      const known = memo.get(key)
      if (known !== undefined) return known
      const test = segment[i]
      const result =
        test === null || test === undefined
          ? match(i + 1, j) || (j < names.length && match(i, j + 1))
          : j < names.length && test(names[j] ?? '') && match(i + 1, j + 1)
      memo.set(key, result)
      return result
    }
    return match(0, 0)
  }
}
