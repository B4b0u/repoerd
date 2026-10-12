// @vitest-environment jsdom
import { apiPaths } from '@repoerd/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../../src/app/App'
import { ApiError } from '../../src/shared/api/client'
import { sessionKeys } from '../../src/shared/api/session'

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

/** Runs a query that fails with `error` through the real client, as the app does. */
async function failingQuery(queryKey: readonly string[], error: ApiError) {
  const assign = vi.fn()
  const real = window.location
  vi.stubGlobal('location', {
    get pathname() {
      return real.pathname
    },
    get search() {
      return real.search
    },
    assign,
  })
  const client = createQueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  await client
    .fetchQuery({
      queryKey,
      queryFn: () => Promise.reject(error),
    })
    .catch(() => undefined)
  return { assign, invalidate }
}

describe('createQueryClient', () => {
  it('sends the user through GitHub again on reauth_required of another query', async () => {
    window.history.replaceState(null, '', '/acme/app?b=main')
    const { assign } = await failingQuery(['repos'], new ApiError(401, 'reauth_required', 'x'))
    expect(assign).toHaveBeenCalledWith(apiPaths.signIn('/acme/app?b=main'))
  })

  it('leaves errors of the me query to the gate', async () => {
    const { assign, invalidate } = await failingQuery(
      sessionKeys.me,
      new ApiError(401, 'reauth_required', 'x'),
    )
    expect(assign).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('refreshes me on unauthenticated of another query', async () => {
    const { assign, invalidate } = await failingQuery(
      ['repos'],
      new ApiError(401, 'unauthenticated', 'x'),
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: sessionKeys.me })
    expect(assign).not.toHaveBeenCalled()
  })
})

describe('createQueryClient mutations', () => {
  it('sends the user through GitHub again when a mutation gets reauth_required', async () => {
    window.history.replaceState(null, '', '/acme/shop/settings')
    const assign = vi.fn()
    const real = window.location
    vi.stubGlobal('location', {
      get pathname() {
        return real.pathname
      },
      get search() {
        return real.search
      },
      assign,
    })
    const client = createQueryClient()
    await client
      .getMutationCache()
      .build(client, {
        mutationFn: () => Promise.reject(new ApiError(401, 'reauth_required', 'x')),
      })
      .execute(undefined)
      .catch(() => undefined)
    expect(assign).toHaveBeenCalledWith(apiPaths.signIn('/acme/shop/settings'))
  })

  it('refreshes me, without redirecting, when a mutation gets unauthenticated', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { pathname: '/acme/shop/settings', search: '', assign })
    const client = createQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await client
      .getMutationCache()
      .build(client, {
        mutationFn: () => Promise.reject(new ApiError(401, 'unauthenticated', 'x')),
      })
      .execute(undefined)
      .catch(() => undefined)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: sessionKeys.me })
    expect(assign).not.toHaveBeenCalled()
  })
})
