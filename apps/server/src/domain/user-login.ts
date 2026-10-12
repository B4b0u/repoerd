/**
 * Added to the login of an account whose GitHub login another account now holds (renamed on
 * GitHub, login reused). `~` cannot appear in a GitHub login, so it never collides.
 */
export const STALE_LOGIN_SUFFIX = '~stale'

/** The login to show, and whether it is a former login of the account. */
export function readStoredLogin(login: string): { login: string; stale: boolean } {
  return login.endsWith(STALE_LOGIN_SUFFIX)
    ? { login: login.slice(0, -STALE_LOGIN_SUFFIX.length), stale: true }
    : { login, stale: false }
}
