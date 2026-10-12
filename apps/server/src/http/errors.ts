import type { ApiErrorBody, ApiErrorCode, ApiErrorDetails } from '@repoerd/contracts'
import type { Context } from 'hono'
import {
  GitHubRateLimitedError,
  GitHubUnavailableError,
} from '../application/ports/github-errors.js'
import type { RepoAccessError } from '../application/use-cases/repo-access.js'
import type { ManualSourceRejection } from '../domain/manual-sources.js'
import type { AppLogger } from './types.js'

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 502 | 503

export function apiError(
  c: Context,
  status: ErrorStatus,
  code: ApiErrorCode,
  message: string,
  details?: ApiErrorDetails,
) {
  const error = details ? { code, message, details } : { code, message }
  return c.json({ error } satisfies ApiErrorBody, status)
}

/** GitHub trouble is routine: a warning without stack. Anything else is an error. */
export function logFailure(logger: AppLogger, error: unknown, message: string): void {
  if (error instanceof GitHubRateLimitedError) {
    logger.warn(
      { retryAfterSeconds: error.retryAfterSeconds },
      `${message}: GitHub rate limit reached`,
    )
  } else if (error instanceof GitHubUnavailableError) {
    logger.warn({ reason: error.message }, `${message}: GitHub is not responding`)
  } else {
    logger.error({ err: error }, message)
  }
}

/** Unknown and invisible repositories must get byte-identical answers: use this one 404. */
export const repoNotFound = (c: Context) =>
  apiError(c, 404, 'repo_not_found', 'Repository not found')

export function accessError(c: Context, error: RepoAccessError) {
  switch (error.kind) {
    case 'reauth-required':
      return apiError(c, 401, 'reauth_required', 'Your GitHub sign-in has expired. Sign in again.')
    case 'org-not-allowed':
      return apiError(
        c,
        403,
        'org_not_allowed',
        'Your GitHub account does not belong to an organisation allowed on this instance.',
      )
    case 'repo-not-found':
      return repoNotFound(c)
    case 'repo-moved':
      return apiError(c, 404, 'repo_moved', `Repository moved to ${error.owner}/${error.name}`, {
        owner: error.owner,
        name: error.name,
      })
    case 'forbidden':
      return apiError(c, 403, 'forbidden', 'You need write access to this repository', {
        reason: 'write-access-required',
      })
  }
}

/** English message of refused manual sources (logs, API clients); the web translates `details`. */
export function manualSourcesMessage(rejection: ManualSourceRejection): string {
  switch (rejection.reason) {
    case 'too-many-sources':
      return `At most ${rejection.max} schema sources per repository`
    case 'name-missing':
      return 'Every source needs a name'
    case 'name-control-characters':
      return 'Source names must not contain control characters'
    case 'name-too-long':
      return `Source names are limited to ${rejection.max} characters`
    case 'duplicate-name':
      return `Two sources are named "${rejection.name}"`
    case 'no-path':
      return `Source "${rejection.name}" needs at least one path`
    case 'too-many-paths':
      return `Source "${rejection.name}" has more than ${rejection.max} paths`
    case 'path-too-long':
      return `Paths are limited to ${rejection.max} characters`
    case 'path-invalid':
      return `Path "${rejection.path}" of source "${rejection.name}" must be relative to the repository root, without "..", "\\" or control characters`
  }
}
