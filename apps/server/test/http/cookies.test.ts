import { describe, expect, it } from 'vitest'
import { shortLivedExpiry } from '../../src/http/cookies.js'

describe('shortLivedExpiry', () => {
  it('is 10 minutes from now', () => {
    expect(shortLivedExpiry(new Date('2026-10-10T12:00:00Z'))).toEqual(
      new Date('2026-10-10T12:10:00Z'),
    )
  })
})
