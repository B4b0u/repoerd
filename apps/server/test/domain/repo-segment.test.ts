import { describe, expect, it } from 'vitest'
import { isValidRepoSegment } from '../../src/domain/repo-segment.js'

describe('isValidRepoSegment', () => {
  it('accepts GitHub owner and repository names', () => {
    for (const value of ['acme', 'shop-prisma', 'my.repo', 'A_b-1']) {
      expect(isValidRepoSegment(value)).toBe(true)
    }
  })

  it('rejects empty, dot-only, too long or unsafe values', () => {
    for (const value of ['', '.', '..', 'a b', 'a/b', '%2e', 'x'.repeat(101)]) {
      expect(isValidRepoSegment(value)).toBe(false)
    }
  })
})
