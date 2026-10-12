import { normalizeAllowedOrgs } from '../../domain/admin.js'
import { err, ok, type Result } from '../../domain/result.js'
import { normalizePublicUrl, oauthCallbackUrl } from '../../domain/setup.js'
import type { InstanceConfigRepository } from '../ports/instance-config.js'
import type { SessionRepository } from '../ports/session-repository.js'
import type { AppUser, UserRepository } from '../ports/user-repository.js'
import { type RevokedAccess, revokeUserAccess } from '../services/user-access.js'

export type MaintenanceError =
  | { kind: 'user-not-found'; login: string }
  | { kind: 'invalid-public-url'; input: string }
  | { kind: 'invalid-organization'; login: string }

interface Deps {
  config: InstanceConfigRepository
  users: UserRepository
  sessions: SessionRepository
}

/**
 * The recovery commands of repoerd-admin (spec §4.3). None reads the stored configuration nor a
 * sealed secret: they work when SECRET_KEY no longer opens them, and never touch the mode.
 */
export function makeMaintenance(deps: Deps) {
  return {
    listAdmins: (): Promise<AppUser[]> => deps.users.listAdmins(),

    /** Effective at once: the server reads the user on every request. */
    async promote(
      input: string,
    ): Promise<Result<{ user: AppUser; alreadyAdmin: boolean }, MaintenanceError>> {
      const login = input.trim().replace(/^@/, '')
      const user = await deps.users.findByLogin(login)
      if (!user) return err({ kind: 'user-not-found', login })
      if (user.isAdmin) return ok({ user, alreadyAdmin: true })
      await deps.users.setAdmin(user.id, true)
      return ok({ user: { ...user, isAdmin: true }, alreadyAdmin: false })
    },

    /** Validated like in /admin; the running server keeps its copy until it restarts. */
    async setPublicUrl(
      input: string,
    ): Promise<Result<{ publicUrl: string; callbackUrl: string }, MaintenanceError>> {
      const url = normalizePublicUrl(input)
      if (!url.ok) return err({ kind: 'invalid-public-url', input })
      await deps.config.update({ publicUrl: url.value })
      return ok({ publicUrl: url.value, callbackUrl: oauthCallbackUrl(url.value) })
    },

    /**
     * Replaces the allowed organisations, normalised like PUT /api/admin/config (D24); [] removes
     * the restriction. No self-lockout check: the CLI has no GitHub access. Restart to apply.
     */
    async setAllowedOrgs(logins: readonly string[]): Promise<Result<string[], MaintenanceError>> {
      const orgs = normalizeAllowedOrgs(logins)
      if (!orgs.ok) return orgs
      await deps.config.update({ allowedOrgs: orgs.value })
      return ok(orgs.value)
    },

    /**
     * Forgets the App and the setup code and grant, every GitHub token and every session. Mode,
     * public URL, organisations, administrators, layouts and sources stay. Back to `needs-app`.
     */
    async resetApp(): Promise<RevokedAccess> {
      await deps.config.update({ app: null, setupCodeHash: null, setupGrant: null })
      return revokeUserAccess(deps)
    },
  }
}

export type Maintenance = ReturnType<typeof makeMaintenance>
