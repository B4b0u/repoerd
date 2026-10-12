import { isInsecurePublicUrl } from '@repoerd/contracts'
import type { InstanceConfigRepository } from './application/ports/instance-config.js'
import { SecretKeyMismatchError } from './application/ports/secret-box.js'
import type { SessionRepository } from './application/ports/session-repository.js'
import type { UserRepository } from './application/ports/user-repository.js'
import { type RevokedAccess, revokeUserAccess } from './application/services/user-access.js'
import { githubOrigins } from './infrastructure/github/github-api.js'

/** A start-up refused for a reason the operator must read: main prints the message alone. */
export class StartupError extends Error {
  override name = 'StartupError'
}

export const SECRET_KEY_MISMATCH =
  'The SECRET_KEY does not match the one this database was created with, or a stored secret is corrupted. Restore the original key, or run "repoerd-admin reset-app" to register the GitHub App again (see Recovery in the README).'

export const DEMO_MODE_WARNING =
  'Demo mode: every visitor is an administrator, never use it for real data'

/** Opens the stored secrets once: a SECRET_KEY that cannot stops the start-up, clearly. */
export async function checkStoredSecrets(config: InstanceConfigRepository): Promise<void> {
  try {
    await config.get()
  } catch (error) {
    if (error instanceof SecretKeyMismatchError) throw new StartupError(SECRET_KEY_MISMATCH)
    throw error
  }
}

/**
 * The first start records its GITHUB_MODE in the database; the other mode is refused afterwards:
 * the demo mode makes every visitor an administrator, and a real database must never see it.
 */
export async function claimInstanceMode(
  config: InstanceConfigRepository,
  mode: 'real' | 'fake',
): Promise<void> {
  const current = await config.get()
  // Before the mode was recorded, only a real instance could hold a GitHub App: fake mode never stores one.
  const githubMode = current.githubMode ?? (current.app !== null ? 'real' : null)
  if (githubMode === null) {
    await config.update({ githubMode: mode })
    return
  }
  if (current.githubMode === null) await config.update({ githubMode })
  if (githubMode !== mode) {
    throw new StartupError(
      `This database was created with GITHUB_MODE=${githubMode}: it cannot be used with GITHUB_MODE=${mode}. Point DATABASE_PATH to another database file.`,
    )
  }
}

/**
 * A stored GitHub App belongs to the GitHub it was registered on (the origin of its htmlUrl): a
 * real instance started with the test GitHub would send its tokens there, and an E2E database
 * started without it would send them to github.com. Either way the start-up stops.
 */
export async function checkAppGitHubOrigin(
  config: InstanceConfigRepository,
  testOrigin: string | undefined,
): Promise<void> {
  const app = (await config.get()).app
  if (app === null) return
  const expected = githubOrigins(testOrigin).web
  const registered = originOf(app.htmlUrl)
  if (registered === expected) return
  const where = registered ?? 'an unknown address'
  if (testOrigin)
    throw new StartupError(
      `REPOERD_TEST_GITHUB_URL is set (tests only), but the GitHub App of this database was registered on ${where}. Unset REPOERD_TEST_GITHUB_URL, or point DATABASE_PATH to a test database.`,
    )
  throw new StartupError(
    `The GitHub App of this database was registered on ${where}, not on ${expected}. Point DATABASE_PATH to another database file, or run "repoerd-admin reset-app" to register a GitHub App again (see Recovery in the README).`,
  )
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * An instance without GitHub App holds no usable GitHub token nor session: tokens belong to an
 * App. After `repoerd-admin reset-app` run while the server was up, users may have signed in again
 * through the App that process still remembered: they are signed out before the setup starts.
 */
export async function forgetAccessWithoutApp(deps: {
  config: InstanceConfigRepository
  users: UserRepository
  sessions: SessionRepository
}): Promise<RevokedAccess> {
  if ((await deps.config.get()).app !== null) return { tokensCleared: 0, sessionsDeleted: 0 }
  return revokeUserAccess(deps)
}

/** The warning to log when the public URL uses plain HTTP outside localhost, or null. */
export function insecurePublicUrlWarning(publicUrl: string | null): string | null {
  if (!publicUrl || !isInsecurePublicUrl(publicUrl)) return null
  return `The public URL ${publicUrl} uses plain HTTP: sessions and GitHub sign-ins travel unencrypted. Serve RepoERD over HTTPS behind a reverse proxy.`
}
