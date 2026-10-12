import { describe, expect, it } from 'vitest'
import { isAllowedByOrgs } from '../../src/domain/orgs.js'

describe('isAllowedByOrgs', () => {
  it('lets everybody in when no organisation is configured', () => {
    expect(isAllowedByOrgs([], [])).toBe(true)
  })

  it('needs one accessible installation on an allowed account, ignoring case', () => {
    expect(isAllowedByOrgs(['acme'], ['alice', 'ACME'])).toBe(true)
    expect(isAllowedByOrgs(['acme'], ['alice'])).toBe(false)
    expect(isAllowedByOrgs(['acme'], [])).toBe(false)
  })
})
