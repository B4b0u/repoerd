import { appSettingsUrl, configVersion, normalizeAllowedOrgs } from '../../domain/admin.js'
import { isAllowedByOrgs } from '../../domain/orgs.js'
import { err, ok, type Result } from '../../domain/result.js'
import { installUrl, normalizePublicUrl, oauthCallbackUrl } from '../../domain/setup.js'
import { readStoredLogin } from '../../domain/user-login.js'
import type { InstanceConfigRepository } from '../ports/instance-config.js'
import type { RepoDirectory } from '../ports/repo-directory.js'
import type { SessionRepository } from '../ports/session-repository.js'
import type { AppUser, UserRepository } from '../ports/user-repository.js'

export type AdminError =
  | { kind: 'invalid-organization'; login: string }
  | { kind: 'invalid-public-url' }
  | { kind: 'self-lockout' }
  | { kind: 'reauth-required' }
  | { kind: 'user-not-found' }
  | { kind: 'not-admin' }
  | { kind: 'last-admin' }
  | { kind: 'config-changed' }

export interface AdminConfigView {
  /** Fingerprint of the editable configuration: a save from an older copy is refused. */
  version: string
  publicUrl: string | null
  /** The OAuth callback URL the GitHub App must declare (RepoERD cannot change it on GitHub). */
  callbackUrl: string | null
  allowedOrgs: string[]
  app: {
    name: string
    ownerLogin: string
    htmlUrl: string
    installUrl: string
    settingsUrl: string
  } | null
}

/** A user as the administration shows them (spec §4.4). */
export interface AdminUserView {
  id: string
  /** Without the `~stale` mark. */
  login: string
  /** Another account holds this login now: it is a former login of this account. */
  stale: boolean
  avatarUrl: string | null
  isAdmin: boolean
  lastSeenAt: Date | null
  /** Sessions still valid now. */
  activeSessions: number
}

interface Deps {
  config: InstanceConfigRepository
  users: UserRepository
  directory: RepoDirectory
  sessions: SessionRepository
  now: () => Date
}

export function makeAdmin(deps: Deps) {
  async function getConfig(): Promise<AdminConfigView> {
    const { publicUrl, allowedOrgs, app } = await deps.config.get()
    return {
      version: configVersion({ publicUrl, allowedOrgs, appId: app?.appId ?? null }),
      publicUrl,
      callbackUrl: publicUrl ? oauthCallbackUrl(publicUrl) : null,
      allowedOrgs,
      app: app
        ? {
            name: app.name,
            ownerLogin: app.ownerLogin,
            htmlUrl: app.htmlUrl,
            installUrl: installUrl(app.htmlUrl),
            settingsUrl: appSettingsUrl(app),
          }
        : null,
    }
  }

  async function listUsers(): Promise<AdminUserView[]> {
    const [users, active] = await Promise.all([
      deps.users.listUsers(),
      deps.sessions.countActiveByUser(deps.now()),
    ])
    return users.map((user) => ({
      id: user.id,
      ...readStoredLogin(user.login),
      avatarUrl: user.avatarUrl,
      isAdmin: user.isAdmin,
      lastSeenAt: user.lastSeenAt,
      activeSessions: active.get(user.id) ?? 0,
    }))
  }

  return {
    getConfig,
    listUsers,

    /** "Sign out everywhere": ends every session of the user (their GitHub tokens stay). */
    async signOutEverywhere(id: string): Promise<Result<AdminUserView[], AdminError>> {
      if (!(await deps.users.get(id))) return err({ kind: 'user-not-found' })
      await deps.sessions.deleteForUser(id)
      return ok(await listUsers())
    },

    async updateConfig(
      adminId: string,
      input: { allowedOrgs: string[]; publicUrl?: string; version?: string },
    ): Promise<Result<AdminConfigView, AdminError>> {
      const orgs = normalizeAllowedOrgs(input.allowedOrgs)
      if (!orgs.ok) return orgs
      let publicUrl: string | undefined
      if (input.publicUrl !== undefined) {
        const url = normalizePublicUrl(input.publicUrl)
        if (!url.ok) return url
        publicUrl = url.value
      }
      // Saved from an older copy of the page: another administrator changed something since,
      // which is said before any GitHub read.
      if (input.version !== undefined && input.version !== (await getConfig()).version)
        return err({ kind: 'config-changed' })
      // The administrator must still be able to sign in once the restriction applies.
      if (orgs.value.length > 0) {
        const access = await deps.directory.forUser(adminId, { fresh: true })
        if (!access) return err({ kind: 'reauth-required' })
        if (!isAllowedByOrgs(orgs.value, access.accounts)) return err({ kind: 'self-lockout' })
      }
      await deps.config.update({ allowedOrgs: orgs.value, ...(publicUrl ? { publicUrl } : {}) })
      return ok(await getConfig())
    },

    listAdmins: () => deps.users.listAdmins(),

    async addAdmin(login: string): Promise<Result<AppUser[], AdminError>> {
      const user = await deps.users.findByLogin(login.trim())
      if (!user) return err({ kind: 'user-not-found' })
      if (!user.isAdmin) await deps.users.setAdmin(user.id, true)
      return ok(await deps.users.listAdmins())
    },

    async removeAdmin(id: string): Promise<Result<AppUser[], AdminError>> {
      const user = await deps.users.get(id)
      if (!user) return err({ kind: 'user-not-found' })
      if (!user.isAdmin) return err({ kind: 'not-admin' })
      if (!(await deps.users.demoteAdmin(id))) {
        // Refused: either they were the last administrator, or a concurrent removal won.
        const current = await deps.users.get(id)
        return err({ kind: current?.isAdmin ? 'last-admin' : 'not-admin' })
      }
      return ok(await deps.users.listAdmins())
    },
  }
}

export type Admin = ReturnType<typeof makeAdmin>
