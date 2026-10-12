import {
  APP_REPLACED_PATH,
  adminExistingAppBodySchema,
  adminManifestBodySchema,
  apiPaths,
  type ManifestResponse,
} from '@repoerd/contracts'
import type { ReplaceAppError } from '../../application/use-cases/replace-app.js'
import { REPLACE_CALLBACK_PATH } from '../../domain/setup.js'
import {
  clearCookie,
  MANIFEST_COOKIE,
  readCookie,
  SESSION_COOKIE,
  setHttpOnlyCookie,
  shortLivedExpiry,
} from '../cookies.js'
import { apiError, logFailure } from '../errors.js'
import { readBody } from '../read-body.js'
import type { AppContext, AppHono, RealModeDeps } from '../types.js'

function replaceAppError(c: AppContext, error: ReplaceAppError) {
  switch (error.kind) {
    case 'invalid-organization':
      return apiError(
        c,
        400,
        'bad_request',
        `"${error.login}" is not a valid GitHub organisation name`,
        { reason: 'invalid-organization', login: error.login },
      )
    case 'not-configured':
      return apiError(
        c,
        400,
        'bad_request',
        'The public URL must be an http(s) address without path, like https://erd.example.com',
        { reason: 'invalid-public-url' },
      )
    case 'github-rejected':
      return apiError(c, 400, 'github_error', 'GitHub rejected these App credentials', {
        reason: 'app-credentials-rejected',
      })
  }
}

/** The rule of the /api/admin middleware: an administrator whose GitHub access still works. */
async function isWorkingAdministrator(c: AppContext, deps: RealModeDeps): Promise<boolean> {
  const session = await deps.auth.resolveSession(readCookie(c, SESSION_COOKIE))
  if (!session?.user.isAdmin) return false
  return (await deps.repoAccess.checkUser(session.user.id)).ok
}

/**
 * Replacing the GitHub App (spec §4.2), real mode only. The JSON routes sit behind the
 * /api/admin middleware: register them after it. GitHub's redirect is a full-page navigation
 * outside /api, so it checks the session and the rights itself.
 */
export function registerReplaceAppRoutes(app: AppHono, deps: RealModeDeps) {
  app.post(apiPaths.adminAppManifest, async (c) => {
    const input = await readBody(c, adminManifestBodySchema)
    if (!input)
      return apiError(c, 400, 'bad_request', 'Invalid request body', { reason: 'invalid-body' })
    const state = deps.randomToken()
    const result = await deps.replaceApp.startManifest({
      organization: input.organization,
      state,
    })
    if (!result.ok) return replaceAppError(c, result.error)
    setHttpOnlyCookie(c, MANIFEST_COOKIE, state, shortLivedExpiry())
    return c.json(result.value satisfies ManifestResponse)
  })

  app.post(apiPaths.adminExistingApp, async (c) => {
    const input = await readBody(c, adminExistingAppBodySchema)
    if (!input)
      return apiError(c, 400, 'bad_request', 'Invalid request body', { reason: 'invalid-body' })
    const result = await deps.replaceApp.saveExistingApp(input)
    if (!result.ok) return replaceAppError(c, result.error)
    // Every session ended, this one included.
    clearCookie(c, SESSION_COOKIE)
    return c.body(null, 204)
  })

  // GitHub redirects here (a top-level GET from github.com: SameSite=Lax cookies are sent).
  app.get(REPLACE_CALLBACK_PATH, async (c) => {
    const expected = readCookie(c, MANIFEST_COOKIE)
    clearCookie(c, MANIFEST_COOKIE)
    const state = c.req.query('state')
    if (!expected || !state || state !== expected) return c.redirect('/admin?error=state')
    try {
      if (!(await isWorkingAdministrator(c, deps))) return c.redirect('/admin?error=forbidden')
      if ((await deps.setup.status()).state !== 'ready')
        return c.redirect('/admin?error=not-configured')
      const result = await deps.replaceApp.completeManifest(c.req.query('code') ?? '')
      if (!result.ok) return c.redirect(`/admin?error=${result.error.kind}`)
    } catch (error) {
      // A full-page navigation: a JSON error would be a dead end. Never log the code.
      logFailure(deps.logger, error, 'GitHub App replacement failed')
      return c.redirect('/admin?error=github')
    }
    clearCookie(c, SESSION_COOKIE)
    return c.redirect(APP_REPLACED_PATH)
  })
}
