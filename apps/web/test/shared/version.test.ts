import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiGet } from '../../src/shared/api/client'
import {
  isNewVersionAvailable,
  noteServerVersion,
  resetServerVersion,
  WEB_VERSION,
} from '../../src/shared/api/version'

afterEach(() => {
  resetServerVersion()
  vi.unstubAllGlobals()
})

describe('server version', () => {
  it('is "dev" for a web build made without REPOERD_VERSION', () => {
    expect(WEB_VERSION).toBe('dev')
  })

  it('says a new version is available once the API answers with another one', () => {
    expect(isNewVersionAvailable()).toBe(false)
    noteServerVersion(null)
    noteServerVersion('dev')
    expect(isNewVersionAvailable()).toBe(false)
    noteServerVersion('0.2.0')
    expect(isNewVersionAvailable()).toBe(true)
  })

  it('reads the version header of every API answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({}, { headers: { 'x-repoerd-version': '0.2.0' } })),
    )
    await apiGet('/api/me')
    expect(isNewVersionAvailable()).toBe(true)
  })
})
