import { apiPaths, type MeResponse, type SetupStatusResponse } from '@repoerd/contracts'
import { type QueryClient, type QueryKey, useQuery } from '@tanstack/react-query'
import { ApiError, apiGet, apiSend } from './client'

export const sessionKeys = {
  setupStatus: ['setup-status'] as const,
  me: ['me'] as const,
}

export function useSetupStatus(enabled = true) {
  return useQuery({
    queryKey: sessionKeys.setupStatus,
    queryFn: () => apiGet<SetupStatusResponse>(apiPaths.setupStatus),
    enabled,
  })
}

export function useMe(enabled = true) {
  return useQuery({
    queryKey: sessionKeys.me,
    queryFn: () => apiGet<MeResponse>(apiPaths.me),
    enabled,
  })
}

export const currentPath = () => `${window.location.pathname}${window.location.search}`

/** One-shot messages of a redirect: only the page that reads them shows them, once. */
const ONE_SHOT_PARAMS = ['error', 'notice']

/** The current path and query without `?error=` and `?notice=`. */
export function pathWithoutError(): string {
  const params = new URLSearchParams(window.location.search)
  for (const name of ONE_SHOT_PARAMS) params.delete(name)
  const query = params.toString()
  return `${window.location.pathname}${query ? `?${query}` : ''}`
}

/** Removes `?error=` and `?notice=` from the address bar: the page keeps what it already read. */
export function dropErrorParam() {
  const params = new URLSearchParams(window.location.search)
  if (!ONE_SHOT_PARAMS.some((name) => params.has(name))) return
  window.history.replaceState(window.history.state, '', pathWithoutError())
}

export async function signOut() {
  await apiSend('POST', apiPaths.logout)
  window.location.assign('/')
}

/** What an API failure means for the session: GitHub sign-in again, sign-in page, or nothing. */
export function authErrorAction(error: unknown): 'sign-in-again' | 'signed-out' | null {
  if (!(error instanceof ApiError) || error.status !== 401) return null
  return error.code === 'reauth_required' ? 'sign-in-again' : 'signed-out'
}

/** Global reaction to a failed query: GitHub sign-in again, or refresh the session (sign-in page). */
export function handleQueryError(queryClient: QueryClient, error: unknown, queryKey: QueryKey) {
  // The gate reads /api/me itself; reacting to it here would loop.
  if (queryKey[0] === sessionKeys.me[0]) return
  const action = authErrorAction(error)
  if (action === 'sign-in-again') window.location.assign(apiPaths.signIn(currentPath()))
  else if (action === 'signed-out') void queryClient.invalidateQueries({ queryKey: sessionKeys.me })
}

/** Transient answers of a proxy, of GitHub or of a busy server: worth one more try. */
const GATEWAY_STATUSES = new Set([502, 503, 504])

/** One more try on a gateway error; a GitHub rate limit waits minutes, retrying cannot help. */
export const retryGatewayOnce = (failureCount: number, error: unknown) =>
  error instanceof ApiError &&
  GATEWAY_STATUSES.has(error.status) &&
  error.code !== 'github_rate_limited' &&
  failureCount < 1

/** Answers of the API are deliberate (401, 404…): network failures twice, gateway errors once. */
export const shouldRetry = (failureCount: number, error: unknown) =>
  error instanceof ApiError ? retryGatewayOnce(failureCount, error) : failureCount < 2
