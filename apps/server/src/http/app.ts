import { MUTATION_HEADER, VERSION_HEADER } from '@repoerd/contracts'
import { Hono, type Next } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { compress } from 'hono/compress'
import {
  GitHubRateLimitedError,
  GitHubUnavailableError,
} from '../application/ports/github-errors.js'
import { ParseQueueFullError } from '../application/ports/schema-toolkit.js'
import { clearCookie, readCookie, SESSION_COOKIE, setHttpOnlyCookie } from './cookies.js'
import { apiError } from './errors.js'
import { registerAccountRoutes } from './routes/account.js'
import { registerAdminRoutes } from './routes/admin.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerFakeModeRoutes } from './routes/fake-mode.js'
import { registerRepoRoutes } from './routes/repos.js'
import { registerSetupRoutes } from './routes/setup.js'
import { securityHeaders } from './security-headers.js'
import type { AppContext, AppDeps, AppEnv, RealModeDeps } from './types.js'
import { serveWebBuild } from './web-assets.js'

export type { AppDeps, AppLogger } from './types.js'

const MAX_BODY_BYTES = 4 * 1024 * 1024
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>()
  app.use('*', securityHeaders())
  // gzip only: Hono's middleware does not do brotli. Schemas of big repositories shrink a lot.
  app.use('*', compress())

  // Docker's HEALTHCHECK: healthy only when SQLite answers.
  app.get('/healthz', (c) => {
    try {
      deps.checkDatabase()
    } catch (error) {
      deps.logger.error({ err: error }, 'Health check: the database does not answer')
      return c.json({ status: 'error', version: deps.version }, 503)
    }
    return c.json({ status: 'ok', version: deps.version })
  })

  // API answers are per user (private repositories): never stored by a browser or a proxy. They
  // name the server's version so that a tab opened before an upgrade can offer to reload.
  // First, so the 413 and 403 answers below carry both too.
  app.use('/api/*', async (c, next) => {
    await next()
    c.header('cache-control', 'no-store')
    c.header(VERSION_HEADER, deps.version)
  })

  // The largest legitimate body (a layout of 5,000 tables) stays far below this.
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) =>
        apiError(c, 413, 'payload_too_large', 'Request body too large (4 MiB at most)'),
    }),
  )

  // CSRF: every mutating API request carries the custom header, setup included.
  app.use('/api/*', async (c, next) => {
    if (MUTATING_METHODS.has(c.req.method) && c.req.header(MUTATION_HEADER) !== '1') {
      return apiError(c, 403, 'forbidden', `Missing ${MUTATION_HEADER} header`, {
        reason: 'missing-mutation-header',
      })
    }
    await next()
  })

  // Public routes come first: handlers run in registration order, so they answer before the
  // authentication middleware below.
  if (deps.mode === 'real') {
    registerSetupRoutes(app, deps)
    registerAuthRoutes(app, deps)
  } else {
    registerFakeModeRoutes(app)
  }

  app.use(
    '/api/*',
    deps.mode === 'real'
      ? sessionMiddleware(deps)
      : async (c, next) => {
          c.set('user', deps.fakeUser)
          c.set('sessionToken', undefined)
          await next()
        },
  )

  registerAccountRoutes(app, deps)
  registerAdminRoutes(app, deps)
  registerRepoRoutes(app, deps)
  // Last: API routes always answer first, unknown API paths fall through to the JSON 404.
  if (deps.webDistPath) app.use('*', serveWebBuild(deps.webDistPath))

  app.notFound((c) => apiError(c, 404, 'not_found', 'Not found'))
  app.onError((error, c) => {
    if (error instanceof GitHubRateLimitedError) {
      deps.logger.warn({ retryAfterSeconds: error.retryAfterSeconds }, 'GitHub rate limit reached')
      if (error.retryAfterSeconds !== null) c.header('retry-after', String(error.retryAfterSeconds))
      return apiError(
        c,
        503,
        'github_rate_limited',
        'GitHub rate limit reached. Try again in a few minutes.',
      )
    }
    if (error instanceof ParseQueueFullError) {
      deps.logger.warn({}, 'Too many parses are waiting: request refused')
      return apiError(c, 503, 'server_busy', 'The server is busy. Try again in a moment.')
    }
    if (error instanceof GitHubUnavailableError) {
      deps.logger.warn({ reason: error.message }, 'GitHub is not responding')
      return apiError(c, 502, 'github_error', 'GitHub is not responding. Try again.')
    }
    deps.logger.error({ err: error }, 'Unhandled request error')
    return apiError(c, 500, 'internal_error', 'Unexpected server error')
  })

  return app
}

function sessionMiddleware(deps: RealModeDeps) {
  // An instance never goes back to setup once ready, so this is checked until it is.
  let ready = false
  return async (c: AppContext, next: Next) => {
    if (!ready) {
      ready = (await deps.setup.status()).state === 'ready'
      if (!ready)
        return apiError(c, 503, 'setup_required', 'RepoERD is not configured yet: open /setup')
    }
    const token = readCookie(c, SESSION_COOKIE)
    const session = await deps.auth.resolveSession(token)
    if (!session) {
      if (token) clearCookie(c, SESSION_COOKIE)
      return apiError(c, 401, 'unauthenticated', 'Sign in required')
    }
    if (token && session.renewedExpiresAt)
      setHttpOnlyCookie(c, SESSION_COOKIE, token, session.renewedExpiresAt)
    c.set('user', session.user)
    c.set('sessionToken', token)
    await next()
  }
}
