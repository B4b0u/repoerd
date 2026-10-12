import { describe, expect, it } from 'vitest'
import { MAX_NESTING, nestingDepth, withinNesting } from '../src/detect/file-guards.js'

describe('nestingDepth', () => {
  it('counts parentheses, brackets and braces', () => {
    expect(nestingDepth('')).toBe(0)
    expect(nestingDepth('a(b[c{d}])')).toBe(3)
    expect(nestingDepth('f(a)(b)[c]')).toBe(1)
  })

  it('ignores brackets in strings and comments', () => {
    const source = `const a = '((([[[' + "{{{" // ((((
/* [[[[[[ */ f(x)`
    expect(nestingDepth(source)).toBe(1)
    expect(nestingDepth(`'it\\'s (' + g(1)`)).toBe(1)
  })

  it('reads template literals and the expressions inside them', () => {
    expect(nestingDepth(`\`(((\${ f([1]) }(((\``)).toBe(3)
    expect(nestingDepth(`\`a \${ \`b \${ c } \` } d\``)).toBe(2)
  })

  it('never throws on unbalanced or unterminated input', () => {
    expect(nestingDepth(')))]]]}}}')).toBe(0)
    expect(nestingDepth('(((')).toBe(3)
    expect(nestingDepth('"unterminated (\n(')).toBe(1)
    expect(nestingDepth('`unterminated ${ (')).toBe(2)
    expect(nestingDepth('/* never closed ((')).toBe(0)
  })

  it('handles a deeply nested file in one linear pass', () => {
    const depth = 200_000
    const start = performance.now()
    expect(nestingDepth(`export default ${'['.repeat(depth)}${']'.repeat(depth)}`)).toBe(depth)
    expect(performance.now() - start).toBeLessThan(500)
  })
})

describe('withinNesting', () => {
  it(`accepts up to ${MAX_NESTING} levels`, () => {
    expect(withinNesting('('.repeat(MAX_NESTING) + ')'.repeat(MAX_NESTING))).toBe(true)
    expect(withinNesting('('.repeat(MAX_NESTING + 1))).toBe(false)
  })
})
