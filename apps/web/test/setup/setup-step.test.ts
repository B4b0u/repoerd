// @vitest-environment jsdom
import type { SetupStatusResponse } from '@repoerd/contracts'
import { describe, expect, it } from 'vitest'
import {
  buildManifestForm,
  isValidAppId,
  setupErrorMessage,
  setupStep,
  trimTrailingSlashes,
} from '../../src/features/setup/setup-step'
import { i18n } from '../../src/shared/i18n/i18n'

const message = (code: string, language = 'en') =>
  setupErrorMessage(i18n.getFixedT(language, 'setup'), i18n.getFixedT(language, 'auth'), code)

const status = (patch: Partial<SetupStatusResponse>): SetupStatusResponse => ({
  mode: 'real',
  state: 'needs-app',
  unlocked: false,
  publicUrl: null,
  app: null,
  ...patch,
})

describe('setupStep', () => {
  it('asks for the setup code until this browser is unlocked', () => {
    expect(setupStep(status({}))).toBe('unlock')
    expect(setupStep(status({ state: 'needs-admin' }))).toBe('unlock')
  })

  it('then registers the App, then signs the administrator in', () => {
    expect(setupStep(status({ unlocked: true }))).toBe('register-app')
    expect(setupStep(status({ state: 'needs-admin', unlocked: true }))).toBe('become-admin')
  })

  it('is done once the instance is ready, in both modes', () => {
    expect(setupStep(status({ state: 'ready' }))).toBe('done')
    expect(setupStep(status({ mode: 'fake', state: 'ready' }))).toBe('done')
  })
})

describe('setupErrorMessage', () => {
  it('explains the callback errors and falls back to a generic message', () => {
    expect(message('state')).toContain('Start again')
    expect(message('invalid-grant')).toContain('setup code again')
    expect(message('github-rejected')).toContain('GitHub refused')
    expect(message('whatever')).toBe('Something went wrong. Start again.')
  })

  it('explains GitHub failures', () => {
    expect(message('github')).toBe(
      'GitHub could not be reached or refused the request. Try again in a few minutes.',
    )
  })

  it('explains sign-in errors carried from /signin', () => {
    expect(message('signin-denied')).toBe('Sign-in was cancelled on GitHub.')
    expect(message('signin-github')).toContain('GitHub could not be reached')
    const refused = message('signin-invalid-code')
    expect(refused).toContain('GitHub refused the sign-in')
    expect(refused).toContain('client secret')
    expect(refused).toContain('callback URL')
    expect(refused).toContain('another GitHub App')
  })

  it('explains a refused sign-in in French too', () => {
    const refused = message('signin-invalid-code', 'fr')
    expect(refused).toContain('GitHub a refusé la connexion')
    expect(refused).toContain('secret client')
  })
})

describe('buildManifestForm', () => {
  it('posts the manifest as JSON in a hidden field', () => {
    const manifest = { name: 'RepoERD', url: 'https://erd.example.com' }
    const form = buildManifestForm(
      document,
      'https://github.com/settings/apps/new?state=s1',
      manifest,
    )
    expect(form.method).toBe('post')
    expect(form.action).toBe('https://github.com/settings/apps/new?state=s1')
    const input = form.querySelector('input')
    expect(input?.type).toBe('hidden')
    expect(input?.name).toBe('manifest')
    expect(JSON.parse(input?.value ?? '')).toEqual(manifest)
  })

  it('refuses a target other than https://github.com/', () => {
    for (const url of [
      'http://github.com/settings/apps/new',
      'https://github.com.evil.example/settings/apps/new',
      'https://evil.example/',
      'javascript:alert(1)',
    ]) {
      expect(() => buildManifestForm(document, url, {})).toThrow('github.com')
    }
  })
})

describe('setup fields', () => {
  it('drops the trailing slashes of a public URL', () => {
    expect(trimTrailingSlashes(' https://erd.example.com// ')).toBe('https://erd.example.com')
    expect(trimTrailingSlashes('https://erd.example.com')).toBe('https://erd.example.com')
  })

  it('accepts a positive whole App ID only', () => {
    expect(isValidAppId(' 123456 ')).toBe(true)
    for (const text of ['', '0', '-1', '12.5', 'abc', '1e5', '12345678901']) {
      expect(isValidAppId(text)).toBe(false)
    }
  })
})
