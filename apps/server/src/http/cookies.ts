import { LOCAL_HOSTNAMES } from '@repoerd/contracts'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

export const SESSION_COOKIE = 'repoerd_session'
/** Setup grant: this browser entered the one-time setup code. */
export const SETUP_COOKIE = 'repoerd_setup'
/** OAuth state + where to go after sign-in. */
export const OAUTH_COOKIE = 'repoerd_oauth'
/** State of the GitHub App manifest flow. */
export const MANIFEST_COOKIE = 'repoerd_manifest'

const SHORT_LIVED_MS = 10 * 60 * 1000

export const shortLivedExpiry = (now = new Date()) => new Date(now.getTime() + SHORT_LIVED_MS)

/** Secure everywhere, except plain HTTP on localhost (development without TLS). */
export function isSecureRequest(c: Context): boolean {
  const url = new URL(c.req.url)
  if (url.protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https') return true
  return !LOCAL_HOSTNAMES.has(url.hostname)
}

/**
 * Secure cookies are named `__Host-<name>`: the browser then refuses them from a sibling
 * subdomain (cookie tossing) and only accepts them Secure, on Path=/ and without Domain.
 */
export function cookieName(c: Context, name: string): string {
  return isSecureRequest(c) ? `__Host-${name}` : name
}

/** Over HTTPS only the `__Host-` cookie counts: an unprefixed one may come from a sibling site. */
export function readCookie(c: Context, name: string): string | undefined {
  return getCookie(c, cookieName(c, name))
}

export function setHttpOnlyCookie(c: Context, name: string, value: string, expires: Date) {
  setCookie(c, cookieName(c, name), value, {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: 'Lax',
    path: '/',
    expires,
  })
}

export function clearCookie(c: Context, name: string) {
  deleteCookie(c, cookieName(c, name), { path: '/', secure: isSecureRequest(c) })
}
