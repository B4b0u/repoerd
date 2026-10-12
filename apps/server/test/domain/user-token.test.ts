import { describe, expect, it } from 'vitest'
import { tokenAction } from '../../src/domain/user-token.js'

const now = new Date('2026-10-10T12:00:00Z')
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000)

describe('tokenAction', () => {
  it('uses non-expiring tokens and tokens valid for more than 5 minutes', () => {
    expect(
      tokenAction(
        { accessTokenExpiresAt: null, refreshToken: null, refreshTokenExpiresAt: null },
        now,
      ),
    ).toBe('use')
    expect(
      tokenAction(
        { accessTokenExpiresAt: at(6), refreshToken: 'r', refreshTokenExpiresAt: at(100) },
        now,
      ),
    ).toBe('use')
  })

  it('refreshes from exactly 5 minutes before expiry', () => {
    const expiringIn = (ms: number) =>
      tokenAction(
        {
          accessTokenExpiresAt: new Date(now.getTime() + ms),
          refreshToken: 'r',
          refreshTokenExpiresAt: null,
        },
        now,
      )
    expect(expiringIn(5 * 60_000)).toBe('refresh')
    expect(expiringIn(5 * 60_000 + 1)).toBe('use')
  })

  it('refreshes tokens about to expire while the refresh token is valid', () => {
    expect(
      tokenAction(
        { accessTokenExpiresAt: at(4), refreshToken: 'r', refreshTokenExpiresAt: at(100) },
        now,
      ),
    ).toBe('refresh')
    expect(
      tokenAction(
        { accessTokenExpiresAt: at(-60), refreshToken: 'r', refreshTokenExpiresAt: null },
        now,
      ),
    ).toBe('refresh')
  })

  it('asks for a new sign-in otherwise', () => {
    expect(
      tokenAction(
        { accessTokenExpiresAt: at(4), refreshToken: null, refreshTokenExpiresAt: null },
        now,
      ),
    ).toBe('reauth')
    expect(
      tokenAction(
        { accessTokenExpiresAt: at(-1), refreshToken: 'r', refreshTokenExpiresAt: at(-1) },
        now,
      ),
    ).toBe('reauth')
  })
})
