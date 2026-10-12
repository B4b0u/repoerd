import type { SignedIn, SignInError } from '../../application/use-cases/auth.js'
import { safeNextPath } from '../../domain/redirect.js'
import type { Result } from '../../domain/result.js'
import {
  clearCookie,
  OAUTH_COOKIE,
  readCookie,
  SESSION_COOKIE,
  SETUP_COOKIE,
  setHttpOnlyCookie,
  shortLivedExpiry,
} from '../cookies.js'
import { logFailure } from '../errors.js'
import type { AppHono, RealModeDeps } from '../types.js'

const encodeNext = (next: string) => Buffer.from(next, 'utf8').toString('base64url')
const decodeNext = (encoded: string) =>
  safeNextPath(Buffer.from(encoded, 'base64url').toString('utf8'))

/** GitHub App OAuth (web flow, with state). Not under /api: these are full-page navigations. */
export function registerAuthRoutes(app: AppHono, deps: RealModeDeps) {
  app.get('/auth/login', async (c) => {
    const state = deps.randomToken()
    const started = await deps.auth.beginSignIn(state)
    if (!started.ok) return c.redirect('/setup')
    const next = safeNextPath(c.req.query('next'))
    setHttpOnlyCookie(c, OAUTH_COOKIE, `${state}.${encodeNext(next)}`, shortLivedExpiry())
    return c.redirect(started.value.url)
  })

  app.get('/auth/callback', async (c) => {
    const [expected = '', encodedNext = ''] = (readCookie(c, OAUTH_COOKIE) ?? '').split('.')
    clearCookie(c, OAUTH_COOKIE)
    const state = c.req.query('state')
    if (!expected || state !== expected) return c.redirect('/signin?error=state')
    const code = c.req.query('code')
    if (c.req.query('error') || !code) return c.redirect('/signin?error=denied')

    let result: Result<SignedIn, SignInError>
    try {
      result = await deps.auth.completeSignIn({ code, setupGrant: readCookie(c, SETUP_COOKIE) })
    } catch (error) {
      // A full-page navigation: a JSON error would be a dead end. Never log the code.
      logFailure(deps.logger, error, 'GitHub sign-in failed')
      return c.redirect('/signin?error=github')
    }
    if (!result.ok) return c.redirect(`/signin?error=${result.error.kind}`)
    setHttpOnlyCookie(c, SESSION_COOKIE, result.value.session, result.value.expiresAt)
    // The setup grant is spent (or useless) once someone signed in from this browser.
    clearCookie(c, SETUP_COOKIE)
    return c.redirect(decodeNext(encodedNext))
  })
}
