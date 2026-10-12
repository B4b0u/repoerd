import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig, weakSecretKey } from '../src/config.js'

const SECRET = 'Kq3vR8wZt1Yp6Nf2Lh9Xc4Bj7Md0Gs5A'

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({ SECRET_KEY: SECRET })).toEqual({
      secretKey: SECRET,
      databasePath: '/data/repoerd.sqlite',
      port: 3000,
      githubMode: 'real',
      fixturesPath: undefined,
      webDistPath: undefined,
      version: 'dev',
      githubTestOrigin: undefined,
    })
  })

  it('accepts a fake GitHub on this machine for the tests, and nothing else', () => {
    for (const url of ['http://127.0.0.1:3402', 'http://127.0.0.1:1', 'http://127.0.0.1:65535']) {
      expect(
        loadConfig({ SECRET_KEY: SECRET, REPOERD_TEST_GITHUB_URL: url }).githubTestOrigin,
      ).toBe(url)
    }
    for (const url of [
      // One spelling only: the origin is compared as a string with the stored App's URL.
      'http://localhost:3402',
      'http://127.0.0.1:0',
      'http://127.0.0.1:65536',
      'http://127.0.0.1:03402',
      'https://127.0.0.1:3402',
      'http://10.0.0.5:3402',
      'http://127.0.0.1:3402/',
      'http://127.0.0.1',
      'http://evil.example:3402',
      'http://127.0.0.1.evil.example:3402',
      'http://localhost:3402@evil.example',
    ]) {
      expect(() => loadConfig({ SECRET_KEY: SECRET, REPOERD_TEST_GITHUB_URL: url })).toThrow(
        ConfigError,
      )
    }
  })

  it('reports a bad test GitHub URL on exactly one line', () => {
    for (const url of ['http://127.0.0.1:65536', 'http://10.0.0.5:3402']) {
      let message = ''
      try {
        loadConfig({ SECRET_KEY: SECRET, REPOERD_TEST_GITHUB_URL: url })
      } catch (error) {
        message = (error as Error).message
      }
      expect(message.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(1)
    }
  })

  it('reads the web build folder and the version', () => {
    expect(
      loadConfig({ SECRET_KEY: SECRET, WEB_DIST_PATH: '/srv/web', REPOERD_VERSION: '1.2.3' }),
    ).toMatchObject({ webDistPath: '/srv/web', version: '1.2.3' })
  })

  it('turns an empty web build folder into "do not serve the web"', () => {
    expect(loadConfig({ SECRET_KEY: SECRET, WEB_DIST_PATH: '' }).webDistPath).toBeNull()
    expect(loadConfig({ SECRET_KEY: SECRET, WEB_DIST_PATH: '  ' }).webDistPath).toBeNull()
  })

  it('reads explicit values', () => {
    expect(
      loadConfig({
        SECRET_KEY: SECRET,
        DATABASE_PATH: './data/dev.sqlite',
        PORT: '8080',
        GITHUB_MODE: 'fake',
        FIXTURES_PATH: '/tmp/fixtures',
      }),
    ).toMatchObject({
      databasePath: './data/dev.sqlite',
      port: 8080,
      githubMode: 'fake',
      fixturesPath: '/tmp/fixtures',
    })
  })

  it('refuses published and poor keys in real mode, not in the demo mode', () => {
    for (const key of [
      'demo-only-secret-key-0123456789abcdef',
      'development-only-secret-key-do-not-use-in-production',
      'x'.repeat(32),
      'ab'.repeat(16),
      'abcd'.repeat(8),
    ]) {
      expect(() => loadConfig({ SECRET_KEY: key })).toThrowError(/SECRET_KEY/)
      expect(loadConfig({ SECRET_KEY: key, GITHUB_MODE: 'fake' }).secretKey).toBe(key)
    }
  })

  it('accepts random hex keys, even when some hex digits are missing', () => {
    const hex32 = '3f9a1c07be52d84e6a0b7c13d9e5f284'
    const hexMissingDigits = '0123456789ab'.repeat(6).slice(0, 64)
    expect(new Set(hexMissingDigits).size).toBe(12)
    expect(loadConfig({ SECRET_KEY: hexMissingDigits }).secretKey).toBe(hexMissingDigits)
    expect(loadConfig({ SECRET_KEY: hex32 }).secretKey).toBe(hex32)
    expect(weakSecretKey(hex32)).toBeNull()
  })

  it('explains why a key is weak', () => {
    expect(weakSecretKey('demo-only-secret-key-0123456789abcdef')).toContain('published')
    // The way out for an existing instance: a new key, then reset-app.
    expect(weakSecretKey('demo-only-secret-key-0123456789abcdef')).toContain(
      'repoerd-admin reset-app',
    )
    expect(weakSecretKey('a'.repeat(40))).toContain('fewer than 8 distinct characters')
    expect(weakSecretKey(SECRET)).toBeNull()
  })

  it('lists every invalid variable', () => {
    expect(() =>
      loadConfig({ SECRET_KEY: 'short', PORT: 'abc', GITHUB_MODE: 'nope' }),
    ).toThrowError(ConfigError)
    expect(() => loadConfig({ PORT: 'abc' })).toThrowError(/SECRET_KEY[\s\S]*PORT/)
  })
})
