import { useEffect } from 'react'
import { useLocation } from 'wouter'
import { ApiError } from './client'

/**
 * Where an answer `repo_moved` sends the page: the same path and query under the current owner
 * and name of the repository (renamed or transferred on GitHub); null for any other error.
 */
export function movedRepoPath(
  error: unknown,
  location: { pathname: string; search: string },
): string | null {
  if (!(error instanceof ApiError) || error.code !== 'repo_moved') return null
  const { owner, name } = error.details
  if (typeof owner !== 'string' || typeof name !== 'string') return null
  const rest = location.pathname.split('/').slice(3)
  const segments = ['', encodeURIComponent(owner), encodeURIComponent(name), ...rest]
  return `${segments.join('/')}${location.search}`
}

/** Replaces the URL by the repository's current one as soon as an answer says it moved. */
export function useFollowRepoMove(error: unknown): void {
  const [, navigate] = useLocation()
  useEffect(() => {
    const target = movedRepoPath(error, window.location)
    if (target) navigate(target, { replace: true })
  }, [error, navigate])
}
