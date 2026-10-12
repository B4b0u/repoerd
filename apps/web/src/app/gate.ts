import type { SetupStatusResponse } from '@repoerd/contracts'

export type GateDecision = 'loading' | 'setup' | 'sign-in' | 'app'

/** Setup first (spec §8: every page redirects to /setup), then a signed-in user. */
export function decideGate(input: {
  path: string
  setup: SetupStatusResponse | undefined
  signedIn: boolean | undefined
}): GateDecision {
  if (input.path === '/setup') return 'app'
  if (!input.setup) return 'loading'
  if (input.setup.state !== 'ready') return 'setup'
  if (input.path === '/signin') return 'sign-in'
  if (input.signedIn === undefined) return 'loading'
  return input.signedIn ? 'app' : 'sign-in'
}

/** A sign-in error would be lost on the way to /setup (e.g. a wrong client secret): carry it. */
export function setupRedirectTarget(path: string, search: string): string {
  const error = path === '/signin' ? new URLSearchParams(search).get('error') : null
  return error ? `/setup?${new URLSearchParams({ error: `signin-${error}` })}` : '/setup'
}
