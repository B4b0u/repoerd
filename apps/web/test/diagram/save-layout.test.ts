// @vitest-environment jsdom
import { apiPaths } from '@repoerd/contracts'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveLayout } from '../../src/features/diagram/api'
import { ApiError } from '../../src/shared/api/client'
import { sessionKeys } from '../../src/shared/api/session'

afterEach(() => vi.unstubAllGlobals())

function stubLocation(path = '/acme/shop') {
  const assign = vi.fn()
  vi.stubGlobal('location', { pathname: path, search: '', assign })
  return assign
}

describe('saveLayout', () => {
  it('reports success', async () => {
    expect(await saveLayout(new QueryClient(), async () => {})).toBe('saved')
  })

  it('sends the user through GitHub again when the authorisation expired during the save', async () => {
    const assign = stubLocation()
    const saved = await saveLayout(new QueryClient(), () =>
      Promise.reject(new ApiError(401, 'reauth_required', 'x')),
    )
    expect(saved).toBe('signing-in')
    expect(assign).toHaveBeenCalledWith(apiPaths.signIn('/acme/shop'))
  })

  it('shows the sign-in page when the session ended during the save', async () => {
    stubLocation()
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    expect(
      await saveLayout(client, () => Promise.reject(new ApiError(401, 'unauthenticated', 'x'))),
    ).toBe('signing-in')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: sessionKeys.me })
  })

  it('only reports other failures', async () => {
    const assign = stubLocation()
    expect(
      await saveLayout(new QueryClient(), () =>
        Promise.reject(new ApiError(500, 'internal_error', 'x')),
      ),
    ).toBe('failed')
    expect(assign).not.toHaveBeenCalled()
  })
})
