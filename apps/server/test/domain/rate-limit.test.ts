import { describe, expect, it } from 'vitest'
import { createRateLimiter } from '../../src/domain/rate-limit.js'

describe('createRateLimiter', () => {
  it('allows a burst up to the limit, then refills one event per share of the window', () => {
    let clock = 0
    const take = createRateLimiter({ limit: 3, windowMs: 3_000, now: () => clock })
    expect([take('a'), take('a'), take('a')]).toEqual([
      { allowed: true },
      { allowed: true },
      { allowed: true },
    ])
    expect(take('a')).toEqual({ allowed: false, retryAfterSeconds: 1 })
    clock = 999
    expect(take('a')).toMatchObject({ allowed: false })
    clock = 1_000
    expect(take('a')).toEqual({ allowed: true })
    expect(take('a')).toMatchObject({ allowed: false })
  })

  it('keeps keys apart', () => {
    const take = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 })
    expect(take('alice')).toEqual({ allowed: true })
    expect(take('alice')).toEqual({ allowed: false, retryAfterSeconds: 60 })
    expect(take('bob')).toEqual({ allowed: true })
  })

  it('never refills beyond the limit', () => {
    let clock = 0
    const take = createRateLimiter({ limit: 2, windowMs: 1_000, now: () => clock })
    clock = 1_000_000
    expect([take('a'), take('a'), take('a')].map((d) => d.allowed)).toEqual([true, true, false])
  })
})
