import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildFakeModeApp } from './build-app.js'

/** <tmp>/secret.txt next to <tmp>/dist: a file the server must never serve. */
function webBuild() {
  const root = mkdtempSync(path.join(tmpdir(), 'repoerd-web-'))
  writeFileSync(path.join(root, 'secret.txt'), 'TOP-SECRET')
  const dist = path.join(root, 'dist')
  mkdirSync(path.join(dist, 'assets'), { recursive: true })
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>WEB-INDEX</title>')
  writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log("app")')
  writeFileSync(path.join(dist, 'theme-init.js'), 'document.documentElement.dataset.theme="dark"')
  return dist
}

const IMMUTABLE = 'public, max-age=31536000, immutable'

describe('web build', () => {
  it('serves index.html at the root without caching it', async () => {
    const { app } = buildFakeModeApp({ webDistPath: webBuild() })
    const response = await app.request('/')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^text\/html/)
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(await response.text()).toContain('WEB-INDEX')
  })

  it('answers every web route with index.html, including names with a dot', async () => {
    const { app } = buildFakeModeApp({ webDistPath: webBuild() })
    for (const route of [
      '/acme/shop',
      '/acme/my.repo',
      '/acme/shop/settings',
      '/admin',
      '/setup',
    ]) {
      const response = await app.request(route)
      expect(response.status, route).toBe(200)
      expect(response.headers.get('cache-control'), route).toBe('no-cache')
      expect(await response.text(), route).toContain('WEB-INDEX')
    }
  })

  it('serves hashed assets with a long cache', async () => {
    const { app } = buildFakeModeApp({ webDistPath: webBuild() })
    const response = await app.request('/assets/index-abc123.js')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/javascript/)
    expect(response.headers.get('cache-control')).toBe(IMMUTABLE)
    expect(await response.text()).toBe('console.log("app")')
  })

  it('serves the other files of the build without caching them', async () => {
    const { app } = buildFakeModeApp({ webDistPath: webBuild() })
    const response = await app.request('/theme-init.js')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-cache')
  })

  it('never answers a missing hashed asset with the web app', async () => {
    const { app } = buildFakeModeApp({ webDistPath: webBuild() })
    const response = await app.request('/assets/index-OLD.js')
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).not.toMatch(/html/)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('keeps JSON 404s for unknown server paths', async () => {
    const { app } = buildFakeModeApp({ webDistPath: webBuild() })
    for (const route of ['/api', '/api/nope', '/auth/nope', '/setup/github/nope']) {
      const response = await app.request(route)
      expect(response.status, route).toBe(404)
      expect(await response.json(), route).toEqual({
        error: { code: 'not_found', message: 'Not found' },
      })
    }
  })

  it('answers HEAD like GET and refuses other methods on web routes', async () => {
    const { app } = buildFakeModeApp({ webDistPath: webBuild() })
    const head = await app.request('/acme/shop', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    const post = await app.request('/acme/shop', { method: 'POST' })
    expect(post.status).toBe(404)
  })

  it('answers HEAD on unknown server paths with 404, never the web app', async () => {
    const { app } = buildFakeModeApp({ webDistPath: webBuild() })
    for (const route of ['/api/nope', '/auth/nope']) {
      const response = await app.request(route, { method: 'HEAD' })
      expect(response.status, route).toBe(404)
      expect(response.headers.get('content-type'), route).not.toMatch(/html/)
      expect(await response.text(), route).toBe('')
    }
  })

  it('never serves a file outside the build folder', async () => {
    const { app } = buildFakeModeApp({ webDistPath: webBuild() })
    for (const route of ['/../secret.txt', '/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt']) {
      const response = await app.request(route)
      expect(await response.text(), route).not.toContain('TOP-SECRET')
    }
  })

  it('serves no web app without a build folder', async () => {
    const { app } = buildFakeModeApp()
    const response = await app.request('/')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })
  })
})
