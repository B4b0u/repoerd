import { describe, expect, it } from 'vitest'
import {
  buildAppManifest,
  installUrl,
  isValidOrganizationLogin,
  manifestPostUrl,
  normalizePublicUrl,
  normalizeSetupCode,
  oauthCallbackUrl,
  REPLACE_CALLBACK_PATH,
  setupState,
} from '../../src/domain/setup.js'

describe('setupState', () => {
  it('goes from the App to the first administrator to ready', () => {
    expect(setupState({ hasApp: false, adminCount: 0 })).toBe('needs-app')
    expect(setupState({ hasApp: true, adminCount: 0 })).toBe('needs-admin')
    expect(setupState({ hasApp: true, adminCount: 2 })).toBe('ready')
  })
})

describe('normalizeSetupCode', () => {
  it('ignores case, spaces and dashes', () => {
    expect(normalizeSetupCode(' abcd-efgh jkmn ')).toBe('ABCDEFGHJKMN')
  })
})

describe('normalizePublicUrl', () => {
  it('keeps the origin of http(s) URLs without path', () => {
    expect(normalizePublicUrl('https://erd.example.com/')).toEqual({
      ok: true,
      value: 'https://erd.example.com',
    })
    expect(normalizePublicUrl(' http://localhost:5173 ')).toEqual({
      ok: true,
      value: 'http://localhost:5173',
    })
  })

  it('rejects other schemes, credentials, paths, queries and garbage', () => {
    for (const url of [
      'ftp://erd.example.com',
      'https://u:p@erd.example.com',
      'https://erd.example.com/erd',
      'https://erd.example.com/?a=1',
      'https://erd.example.com/#x',
      'not a url',
      '',
    ]) {
      expect(normalizePublicUrl(url)).toEqual({ ok: false, error: { kind: 'invalid-public-url' } })
    }
  })
})

describe('isValidOrganizationLogin', () => {
  it('accepts GitHub logins only', () => {
    expect(isValidOrganizationLogin('acme-corp')).toBe(true)
    expect(isValidOrganizationLogin('A1')).toBe(true)
    for (const login of [
      '',
      '-acme',
      'acme-',
      'ac--me',
      'acme corp',
      'acme/evil',
      'a'.repeat(40),
    ]) {
      expect(isValidOrganizationLogin(login)).toBe(false)
    }
  })
})

describe('GitHub App manifest', () => {
  it('declares a private, read-only App without webhook, pointing back to this instance', () => {
    const manifest = buildAppManifest('https://erd.example.com')
    expect(manifest).toEqual({
      name: 'RepoERD erd.example.com',
      url: 'https://erd.example.com',
      redirect_url: 'https://erd.example.com/setup/github/callback',
      callback_urls: ['https://erd.example.com/auth/callback'],
      setup_url: 'https://erd.example.com/',
      public: false,
      default_permissions: { contents: 'read', metadata: 'read' },
      default_events: [],
      request_oauth_on_install: false,
    })
  })

  it('sends GitHub back to the replacement callback when the App is replaced, still private', () => {
    expect(buildAppManifest('https://erd.example.com', REPLACE_CALLBACK_PATH)).toMatchObject({
      redirect_url: 'https://erd.example.com/setup/github/replace-callback',
      callback_urls: ['https://erd.example.com/auth/callback'],
      public: false,
    })
  })

  it('declares the same OAuth callback URL that sign-in and /admin use', () => {
    expect(oauthCallbackUrl('https://erd.example.com')).toBe(
      'https://erd.example.com/auth/callback',
    )
    expect(buildAppManifest('https://erd.example.com').callback_urls).toEqual([
      oauthCallbackUrl('https://erd.example.com'),
    ])
  })

  it('keeps the App name within the 34 characters GitHub allows', () => {
    expect(buildAppManifest('https://a-very-long-host-name.example.com').name).toHaveLength(34)
  })

  it('never ends the App name with a dot or a dash', () => {
    expect(buildAppManifest('https://abcdefghijklmnopqrstuvwxy.example.com').name).toBe(
      'RepoERD abcdefghijklmnopqrstuvwxy',
    )
    expect(buildAppManifest('https://abcdefghijklmnopqrstuvwxy-.example.com').name).toBe(
      'RepoERD abcdefghijklmnopqrstuvwxy',
    )
  })

  it('posts to the personal or organisation App form, with the state', () => {
    expect(manifestPostUrl(undefined, 's1')).toBe('https://github.com/settings/apps/new?state=s1')
    expect(manifestPostUrl('acme-corp', 's1')).toBe(
      'https://github.com/organizations/acme-corp/settings/apps/new?state=s1',
    )
    expect(installUrl('https://github.com/apps/RepoERD')).toBe(
      'https://github.com/apps/RepoERD/installations/new',
    )
  })
})
