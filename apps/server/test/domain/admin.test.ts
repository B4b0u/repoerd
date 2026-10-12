import { describe, expect, it } from 'vitest'
import { appSettingsUrl, configVersion, normalizeAllowedOrgs } from '../../src/domain/admin.js'

describe('normalizeAllowedOrgs', () => {
  it('trims, lower-cases, de-duplicates and sorts the logins', () => {
    expect(normalizeAllowedOrgs([' Acme ', 'beta-corp', 'ACME', ''])).toEqual({
      ok: true,
      value: ['acme', 'beta-corp'],
    })
    expect(normalizeAllowedOrgs([])).toEqual({ ok: true, value: [] })
  })

  it('refuses what cannot be a GitHub login', () => {
    expect(normalizeAllowedOrgs(['acme', 'not an org'])).toEqual({
      ok: false,
      error: { kind: 'invalid-organization', login: 'not an org' },
    })
  })
})

describe('appSettingsUrl', () => {
  it('points to the settings page of the App, under the user or the organisation', () => {
    expect(appSettingsUrl({ slug: 'repoerd-x', ownerLogin: 'alice', ownerType: 'User' })).toBe(
      'https://github.com/settings/apps/repoerd-x',
    )
    expect(
      appSettingsUrl({ slug: 'repoerd-x', ownerLogin: 'acme', ownerType: 'Organization' }),
    ).toBe('https://github.com/organizations/acme/settings/apps/repoerd-x')
  })
})

describe('configVersion', () => {
  it('changes with the public URL, the organisations and the App, and only with them', () => {
    const base = { publicUrl: 'https://erd.example.com', allowedOrgs: ['acme'], appId: 1 }
    expect(configVersion(base)).toMatch(/^[0-9a-f]{8}$/)
    expect(configVersion({ ...base })).toBe(configVersion(base))
    for (const other of [
      { ...base, publicUrl: 'https://other.example.com' },
      { ...base, allowedOrgs: [] },
      { ...base, appId: 2 },
      { ...base, publicUrl: null, appId: null },
    ]) {
      expect(configVersion(other)).not.toBe(configVersion(base))
    }
  })
})
