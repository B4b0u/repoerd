import type { SetupStatusResponse } from '@repoerd/contracts'
import { describe, expect, it } from 'vitest'
import { decideGate, setupRedirectTarget } from '../../src/app/gate'
import { ApiError } from '../../src/shared/api/client'
import { authErrorAction, retryGatewayOnce, shouldRetry } from '../../src/shared/api/session'

const status = (state: SetupStatusResponse['state']): SetupStatusResponse => ({
  mode: 'real',
  state,
  unlocked: false,
  publicUrl: null,
  app: null,
})

describe('decideGate', () => {
  it('always lets the setup page through: it handles every state itself', () => {
    expect(decideGate({ path: '/setup', setup: undefined, signedIn: undefined })).toBe('app')
  })

  it('waits for the setup status, then sends unfinished instances to /setup', () => {
    expect(decideGate({ path: '/', setup: undefined, signedIn: undefined })).toBe('loading')
    expect(
      decideGate({ path: '/acme/shop', setup: status('needs-app'), signedIn: undefined }),
    ).toBe('setup')
    expect(decideGate({ path: '/', setup: status('needs-admin'), signedIn: undefined })).toBe(
      'setup',
    )
  })

  it('then needs a signed-in user', () => {
    const ready = status('ready')
    expect(decideGate({ path: '/', setup: ready, signedIn: undefined })).toBe('loading')
    expect(decideGate({ path: '/', setup: ready, signedIn: false })).toBe('sign-in')
    expect(decideGate({ path: '/', setup: ready, signedIn: true })).toBe('app')
    expect(decideGate({ path: '/signin', setup: ready, signedIn: undefined })).toBe('sign-in')
  })
})

describe('setupRedirectTarget', () => {
  it('carries a sign-in error to the setup page, which explains it', () => {
    expect(setupRedirectTarget('/signin', '?error=invalid-code')).toBe(
      '/setup?error=signin-invalid-code',
    )
    expect(setupRedirectTarget('/signin', 'error=denied')).toBe('/setup?error=signin-denied')
  })

  it('goes to the setup page otherwise', () => {
    expect(setupRedirectTarget('/signin', '')).toBe('/setup')
    expect(setupRedirectTarget('/acme/shop', '?error=invalid-code')).toBe('/setup')
    expect(setupRedirectTarget('/', '')).toBe('/setup')
  })
})

describe('authErrorAction', () => {
  it('goes back through GitHub when the GitHub authorisation expired', () => {
    expect(authErrorAction(new ApiError(401, 'reauth_required', 'x'))).toBe('sign-in-again')
  })

  it('shows the sign-in page when the session is gone, and ignores other errors', () => {
    expect(authErrorAction(new ApiError(401, 'unauthenticated', 'x'))).toBe('signed-out')
    expect(authErrorAction(new ApiError(403, 'forbidden', 'x'))).toBeNull()
    expect(authErrorAction(new Error('offline'))).toBeNull()
  })
})

describe('shouldRetry', () => {
  it('retries network failures twice, and gateway errors once, except a GitHub rate limit', () => {
    expect(shouldRetry(0, new TypeError('Failed to fetch'))).toBe(true)
    expect(shouldRetry(2, new TypeError('Failed to fetch'))).toBe(false)
    expect(shouldRetry(0, new ApiError(502, 'github_error', 'x'))).toBe(true)
    expect(shouldRetry(1, new ApiError(502, 'github_error', 'x'))).toBe(false)
    expect(shouldRetry(0, new ApiError(503, 'server_busy', 'x'))).toBe(true)
    expect(shouldRetry(0, new ApiError(504, 'unknown', 'Gateway Timeout'))).toBe(true)
    expect(shouldRetry(0, new ApiError(503, 'github_rate_limited', 'x'))).toBe(false)
    expect(shouldRetry(0, new ApiError(401, 'unauthenticated', 'x'))).toBe(false)
    expect(shouldRetry(0, new ApiError(500, 'internal_error', 'x'))).toBe(false)
  })

  it('retries the schema and comparison reads only on gateway errors', () => {
    expect(retryGatewayOnce(0, new ApiError(502, 'github_error', 'x'))).toBe(true)
    expect(retryGatewayOnce(1, new ApiError(502, 'github_error', 'x'))).toBe(false)
    expect(retryGatewayOnce(0, new TypeError('Failed to fetch'))).toBe(false)
  })
})
