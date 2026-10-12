import { describe, expect, it } from 'vitest'
import {
  isExpired,
  isPastMaxAge,
  SESSION_LIFETIME_MS,
  SESSION_MAX_AGE_MS,
  sessionExpiresAt,
  shouldTouch,
} from '../../src/domain/session.js'

const now = new Date('2026-10-10T12:00:00Z')
const hours = (n: number) => n * 3600_000

describe('sessions', () => {
  it('last 30 days', () => {
    expect(SESSION_LIFETIME_MS).toBe(30 * 24 * hours(1))
    expect(sessionExpiresAt(now)).toEqual(new Date(now.getTime() + SESSION_LIFETIME_MS))
  })

  it('never last more than 90 days after the sign-in', () => {
    expect(SESSION_MAX_AGE_MS).toBe(90 * 24 * hours(1))
    const signedIn = new Date(now.getTime() - 75 * 24 * hours(1))
    expect(sessionExpiresAt(now, signedIn)).toEqual(
      new Date(signedIn.getTime() + SESSION_MAX_AGE_MS),
    )
    expect(isPastMaxAge(signedIn, now)).toBe(false)
    expect(isPastMaxAge(new Date(now.getTime() - SESSION_MAX_AGE_MS), now)).toBe(true)
  })

  it('expire at their expiry instant', () => {
    expect(isExpired(new Date(now.getTime() + 1), now)).toBe(false)
    expect(isExpired(now, now)).toBe(true)
  })

  it('are renewed at most once a day', () => {
    expect(shouldTouch(new Date(now.getTime() - hours(23)), now)).toBe(false)
    expect(shouldTouch(new Date(now.getTime() - hours(24)), now)).toBe(true)
  })
})
