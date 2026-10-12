import { describe, expect, it } from 'vitest'
import { parseJsonc } from '../src/detect/jsonc.js'

describe('parseJsonc', () => {
  it('reads comments and trailing commas, outside strings only', () => {
    expect(
      parseJsonc(`{
  // a comment
  "a": "http://x/*not a comment*/", /* another */
  "b": [1, 2,],
  "c": "a,}",
}`),
    ).toEqual({ a: 'http://x/*not a comment*/', b: [1, 2], c: 'a,}' })
  })

  it('answers undefined for invalid text', () => {
    expect(parseJsonc('{ "a": ')).toBeUndefined()
  })
})
