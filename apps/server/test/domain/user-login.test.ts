import { describe, expect, it } from 'vitest'
import { readStoredLogin, STALE_LOGIN_SUFFIX } from '../../src/domain/user-login.js'

describe('readStoredLogin', () => {
  it('shows the former login of an account whose login another account took', () => {
    expect(STALE_LOGIN_SUFFIX).toBe('~stale')
    expect(readStoredLogin('bob~stale')).toEqual({ login: 'bob', stale: true })
    expect(readStoredLogin('bob')).toEqual({ login: 'bob', stale: false })
    expect(readStoredLogin('stale')).toEqual({ login: 'stale', stale: false })
  })
})
