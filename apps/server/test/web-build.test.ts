import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveWebBuild } from '../src/web-build.js'

const withIndex = () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'repoerd-dist-'))
  writeFileSync(path.join(folder, 'index.html'), '<!doctype html>')
  return folder
}

describe('resolveWebBuild', () => {
  it('serves nothing when the web is disabled', () => {
    const logs: string[] = []
    expect(resolveWebBuild(null, withIndex(), (m) => logs.push(m))).toBeNull()
    expect(logs).toEqual([])
  })

  it('uses the configured folder, else the default one, when it holds index.html', () => {
    const configured = withIndex()
    expect(resolveWebBuild(configured, '/nowhere', () => {})).toBe(path.resolve(configured))
    const fallback = withIndex()
    expect(resolveWebBuild(undefined, fallback, () => {})).toBe(path.resolve(fallback))
  })

  it('says once that only the API is served when the folder has no index.html', () => {
    const logs: string[] = []
    const empty = mkdtempSync(path.join(tmpdir(), 'repoerd-empty-'))
    expect(resolveWebBuild(empty, '/nowhere', (m) => logs.push(m))).toBeNull()
    expect(logs).toEqual([`No web build in ${path.resolve(empty)}: only the API is served`])
  })
})
