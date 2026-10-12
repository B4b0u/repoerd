// @vitest-environment jsdom
import { apiPaths } from '@repoerd/contracts'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../src/shared/api/client'
import { handleQueryError, sessionKeys } from '../../src/shared/api/session'

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

/** Replaces location.assign only; pathname and search stay live. */
function stubAssign(assign: () => void) {
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
}

function setup() {
  const queryClient = new QueryClient()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
  const assign = vi.fn()
  stubAssign(assign)
  return { queryClient, invalidate, assign }
}

describe('handleQueryError', () => {
  it('ignores errors of the me query, which the gate reads itself', () => {
    const { queryClient, invalidate, assign } = setup()
    handleQueryError(queryClient, new ApiError(401, 'reauth_required', 'x'), sessionKeys.me)
    expect(invalidate).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
  })

  it('sends the user through GitHub again, back to the current path, on reauth_required', () => {
    const { queryClient, assign } = setup()
    vi.stubGlobal('location', {
      ...window.location,
      pathname: '/acme/app',
      search: '?b=main',
      assign,
    })
    handleQueryError(queryClient, new ApiError(401, 'reauth_required', 'x'), ['repos'])
    expect(assign).toHaveBeenCalledWith(apiPaths.signIn('/acme/app?b=main'))
  })

  it('refreshes the session on a 401 unauthenticated of another query', () => {
    const { queryClient, invalidate, assign } = setup()
    handleQueryError(queryClient, new ApiError(401, 'unauthenticated', 'x'), ['repos'])
    expect(invalidate).toHaveBeenCalledWith({ queryKey: sessionKeys.me })
    expect(assign).not.toHaveBeenCalled()
  })

  it('does nothing for other failures', () => {
    const { queryClient, invalidate, assign } = setup()
    handleQueryError(queryClient, new ApiError(500, 'x', 'x'), ['repos'])
    handleQueryError(queryClient, new Error('network'), ['repos'])
    expect(invalidate).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
  })
})
