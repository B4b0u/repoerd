import { err, ok, type Result } from './result.js'

export type SetupState = 'needs-app' | 'needs-admin' | 'ready'

export function setupState(input: { hasApp: boolean; adminCount: number }): SetupState {
  if (!input.hasApp) return 'needs-app'
  return input.adminCount === 0 ? 'needs-admin' : 'ready'
}

/** How long the browser that entered the setup code may keep configuring the instance. */
export const SETUP_GRANT_LIFETIME_MS = 60 * 60 * 1000

export const normalizeSetupCode = (input: string) => input.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** The public URL is an http(s) origin: RepoERD is served at the root of its host. */
export function normalizePublicUrl(input: string): Result<string, { kind: 'invalid-public-url' }> {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return err({ kind: 'invalid-public-url' })
  }
  const valid =
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    !url.username &&
    !url.password &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash
  return valid ? ok(url.origin) : err({ kind: 'invalid-public-url' })
}

const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/
export const isValidOrganizationLogin = (value: string) => GITHUB_LOGIN.test(value)

/** The OAuth callback URL: declared in the App, used at sign-in and shown in /admin. */
export const oauthCallbackUrl = (publicUrl: string) => `${publicUrl}/auth/callback`

/** GitHub limits App names to 34 characters (the user can rename it on GitHub). */
const MAX_APP_NAME = 34

/** A type alias (not an interface) so it is assignable to the contract's Record<string, unknown>. */
export type AppManifest = {
  name: string
  url: string
  redirect_url: string
  callback_urls: string[]
  setup_url: string
  public: boolean
  default_permissions: Record<string, 'read'>
  default_events: string[]
  request_oauth_on_install: boolean
}

/** Where GitHub sends the browser back once it created the App: at setup, and for a replacement. */
export const SETUP_CALLBACK_PATH = '/setup/github/callback'
export const REPLACE_CALLBACK_PATH = '/setup/github/replace-callback'

/**
 * Manifest of a private, read-only App (Contents + Metadata), without webhook (spec §7).
 * No `hook_attributes` at all: GitHub rejects a localhost hook URL even for an inactive hook.
 * Private (`public: false`): only the owning account can install it.
 */
export function buildAppManifest(
  publicUrl: string,
  redirectPath: string = SETUP_CALLBACK_PATH,
): AppManifest {
  return {
    name: `RepoERD ${new URL(publicUrl).host}`.slice(0, MAX_APP_NAME).replace(/[.\- ]+$/, ''),
    url: publicUrl,
    redirect_url: `${publicUrl}${redirectPath}`,
    callback_urls: [oauthCallbackUrl(publicUrl)],
    setup_url: `${publicUrl}/`,
    public: false,
    default_permissions: { contents: 'read', metadata: 'read' },
    default_events: [],
    request_oauth_on_install: false,
  }
}

export function manifestPostUrl(organization: string | undefined, state: string): string {
  const base = organization
    ? `https://github.com/organizations/${encodeURIComponent(organization)}/settings/apps/new`
    : 'https://github.com/settings/apps/new'
  return `${base}?${new URLSearchParams({ state })}`
}

export const installUrl = (appHtmlUrl: string) => `${appHtmlUrl}/installations/new`
