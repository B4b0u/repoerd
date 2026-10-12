import { err, ok, type Result } from './result.js'
import { isValidOrganizationLogin } from './setup.js'

/** Allowed organisations are stored lower-case, de-duplicated and sorted (D24). */
export function normalizeAllowedOrgs(
  input: readonly string[],
): Result<string[], { kind: 'invalid-organization'; login: string }> {
  const logins = new Set<string>()
  for (const raw of input) {
    const login = raw.trim()
    if (login === '') continue
    if (!isValidOrganizationLogin(login)) return err({ kind: 'invalid-organization', login })
    logins.add(login.toLowerCase())
  }
  return ok([...logins].sort())
}

export type AppOwnerType = 'User' | 'Organization'

/** Settings page of the GitHub App on GitHub, under its owner. */
export function appSettingsUrl(app: {
  slug: string
  ownerLogin: string
  ownerType: AppOwnerType
}): string {
  const slug = encodeURIComponent(app.slug)
  return app.ownerType === 'Organization'
    ? `https://github.com/organizations/${encodeURIComponent(app.ownerLogin)}/settings/apps/${slug}`
    : `https://github.com/settings/apps/${slug}`
}

/**
 * A short fingerprint (FNV-1a, 32 bits, hex) of what /admin edits: the public URL, the allowed
 * organisations and the App. A form saved from an older copy of the page carries an older one,
 * and is refused instead of overwriting another administrator's change (spec §6.6).
 */
export function configVersion(config: {
  publicUrl: string | null
  allowedOrgs: readonly string[]
  appId: number | null
}): string {
  const text = JSON.stringify([config.publicUrl, config.allowedOrgs, config.appId])
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
