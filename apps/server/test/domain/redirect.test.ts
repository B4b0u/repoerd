import { describe, expect, it } from 'vitest'
import { safeNextPath } from '../../src/domain/redirect.js'

describe('safeNextPath', () => {
  it('keeps same-origin paths with their query', () => {
    expect(safeNextPath('/acme/shop?branch=feature%2Fx&active=users')).toBe(
      '/acme/shop?branch=feature%2Fx&active=users',
    )
    expect(safeNextPath('/setup')).toBe('/setup')
    // An encoded backslash stays in the path: the browser does not decode it into a host.
    expect(safeNextPath('/%5Cevil.example')).toBe('/%5Cevil.example')
  })

  it('falls back to / for anything that could leave the site', () => {
    for (const next of [
      undefined,
      '',
      'acme/shop',
      '//evil.example',
      '/\\evil.example',
      '/\\/evil.example',
      'https://evil.example',
      '/ok\nSet-Cookie: x',
      '/\t/evil.example',
      '/\r/evil.example',
      '/\u007f',
      'javascript:alert(1)',
    ]) {
      expect(safeNextPath(next)).toBe('/')
    }
  })
})
