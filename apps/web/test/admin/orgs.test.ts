import { describe, expect, it } from 'vitest'
import { formatOrgs, parseOrgs } from '../../src/features/admin/orgs'

describe('organisation list input', () => {
  it('accepts commas, spaces and new lines', () => {
    expect(parseOrgs(' acme, beta-corp\n  gamma ,, ')).toEqual(['acme', 'beta-corp', 'gamma'])
    expect(parseOrgs('   ')).toEqual([])
  })

  it('shows the list comma-separated', () => {
    expect(formatOrgs(['acme', 'beta'])).toBe('acme, beta')
  })
})
