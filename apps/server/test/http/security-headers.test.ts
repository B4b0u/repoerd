import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildFakeModeApp } from './build-app.js'

const EXPECTED_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://avatars.githubusercontent.com",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self' https://github.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
]

function webBuild() {
  const dist = mkdtempSync(path.join(tmpdir(), 'repoerd-web-'))
  mkdirSync(path.join(dist, 'assets'))
  writeFileSync(path.join(dist, 'index.html'), `<!doctype html>${'<p>RepoERD</p>'.repeat(400)}`)
  return dist
}

describe('security headers', () => {
  it('send the content security policy on the web app and on the API', async () => {
    const { app } = buildFakeModeApp({ webDistPath: webBuild() })
    for (const route of ['/', '/acme/shop', '/api/repos', '/healthz']) {
      const csp = (await app.request(route)).headers.get('content-security-policy') ?? ''
      const directives = csp
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
      expect(directives, route).toEqual(expect.arrayContaining(EXPECTED_CSP))
      expect(directives, route).toHaveLength(EXPECTED_CSP.length)
    }
  })

  it('send the usual hardening headers, HSTS without subdomains', async () => {
    const { app } = buildFakeModeApp()
    const headers = (await app.request('/healthz')).headers
    expect(headers.get('x-content-type-options')).toBe('nosniff')
    expect(headers.get('strict-transport-security')).toBe('max-age=15552000')
  })
})

describe('compression', () => {
  it('gzips text responses when the browser accepts it', async () => {
    const { app } = buildFakeModeApp({ webDistPath: webBuild() })
    const response = await app.request('/', { headers: { 'accept-encoding': 'gzip, br' } })
    expect(response.headers.get('content-encoding')).toBe('gzip')
  })

  it('leaves the response alone otherwise', async () => {
    const { app } = buildFakeModeApp({ webDistPath: webBuild() })
    const response = await app.request('/')
    expect(response.headers.get('content-encoding')).toBeNull()
    expect(await response.text()).toContain('RepoERD')
  })
})
