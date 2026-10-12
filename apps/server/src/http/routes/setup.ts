import {
  apiPaths,
  existingAppBodySchema,
  type ManifestResponse,
  manifestBodySchema,
  type SetupStatusResponse,
  setupUnlockBodySchema,
} from '@repoerd/contracts'
import type { SetupError } from '../../application/use-cases/setup.js'
import type { Result } from '../../domain/result.js'
import { SETUP_CALLBACK_PATH } from '../../domain/setup.js'
import {
  clearCookie,
  MANIFEST_COOKIE,
  readCookie,
  SETUP_COOKIE,
  setHttpOnlyCookie,
  shortLivedExpiry,
} from '../cookies.js'
import { apiError, logFailure } from '../errors.js'
import { readBody } from '../read-body.js'
import type { AppContext, AppHono, RealModeDeps } from '../types.js'

function setupError(c: AppContext, error: SetupError) {
  switch (error.kind) {
    case 'invalid-code':
      return apiError(
        c,
        400,
        'invalid_setup_code',
        'Wrong setup code. Use the code printed in the server logs.',
      )
    case 'invalid-grant':
      return apiError(c, 403, 'forbidden', 'Enter the setup code first', {
        reason: 'setup-code-required',
      })
    case 'already-configured':
      return apiError(c, 409, 'conflict', 'RepoERD is already configured', {
        reason: 'already-configured',
      })
    case 'invalid-public-url':
      return apiError(
        c,
        400,
        'bad_request',
        'The public URL must be an http(s) address without path, like https://erd.example.com',
        { reason: 'invalid-public-url' },
      )
    case 'invalid-organization':
      return apiError(
        c,
        400,
        'bad_request',
        `"${error.login}" is not a valid GitHub organisation name`,
        { reason: 'invalid-organization', login: error.login },
      )
    case 'github-rejected':
      return apiError(c, 400, 'github_error', 'GitHub rejected these App credentials', {
        reason: 'app-credentials-rejected',
      })
    case 'too-many-attempts':
      c.header('retry-after', String(error.retryAfterSeconds))
      return apiError(c, 429, 'rate_limited', 'Too many wrong setup codes. Try again in a moment.')
  }
}

const INVALID_BODY = 'Invalid request body'

export function registerSetupRoutes(app: AppHono, deps: RealModeDeps) {
  const grantOf = (c: AppContext) => readCookie(c, SETUP_COOKIE)

  app.get(apiPaths.setupStatus, async (c) =>
    c.json({
      mode: 'real',
      ...(await deps.setup.status(grantOf(c))),
    } satisfies SetupStatusResponse),
  )

  app.post(apiPaths.setupUnlock, async (c) => {
    const input = await readBody(c, setupUnlockBodySchema)
    if (!input) return apiError(c, 400, 'bad_request', INVALID_BODY, { reason: 'invalid-body' })
    const result = await deps.setup.unlock(input.code)
    if (!result.ok) return setupError(c, result.error)
    setHttpOnlyCookie(c, SETUP_COOKIE, result.value.grant, result.value.expiresAt)
    return c.body(null, 204)
  })

  app.post(apiPaths.setupManifest, async (c) => {
    const input = await readBody(c, manifestBodySchema)
    if (!input) return apiError(c, 400, 'bad_request', INVALID_BODY, { reason: 'invalid-body' })
    const state = deps.randomToken()
    const result = await deps.setup.startManifest({
      grant: grantOf(c),
      publicUrl: input.publicUrl,
      organization: input.organization,
      state,
    })
    if (!result.ok) return setupError(c, result.error)
    setHttpOnlyCookie(c, MANIFEST_COOKIE, state, shortLivedExpiry())
    return c.json(result.value satisfies ManifestResponse)
  })

  // GitHub redirects here (a top-level GET from github.com: SameSite=Lax cookies are sent).
  app.get(SETUP_CALLBACK_PATH, async (c) => {
    const expected = readCookie(c, MANIFEST_COOKIE)
    clearCookie(c, MANIFEST_COOKIE)
    const state = c.req.query('state')
    if (!expected || !state || state !== expected) return c.redirect('/setup?error=state')
    let result: Result<void, SetupError>
    try {
      result = await deps.setup.completeManifest({
        grant: grantOf(c),
        code: c.req.query('code') ?? '',
      })
    } catch (error) {
      // A full-page navigation: a JSON error would be a dead end. Never log the code.
      logFailure(deps.logger, error, 'GitHub App creation failed')
      return c.redirect('/setup?error=github')
    }
    return c.redirect(result.ok ? '/setup' : `/setup?error=${result.error.kind}`)
  })

  app.post(apiPaths.setupExistingApp, async (c) => {
    const input = await readBody(c, existingAppBodySchema)
    if (!input) return apiError(c, 400, 'bad_request', INVALID_BODY, { reason: 'invalid-body' })
    const result = await deps.setup.saveExistingApp({ grant: grantOf(c), ...input })
    return result.ok ? c.body(null, 204) : setupError(c, result.error)
  })
}
