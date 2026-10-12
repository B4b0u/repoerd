import { err, ok, type Result } from '../../domain/result.js'
import {
  type AppManifest,
  buildAppManifest,
  isValidOrganizationLogin,
  manifestPostUrl,
  REPLACE_CALLBACK_PATH,
} from '../../domain/setup.js'
import type { AppRegistrar, ExistingAppInput } from '../ports/app-registrar.js'
import type { GitHubAppCredentials, InstanceConfigRepository } from '../ports/instance-config.js'
import type { SessionRepository } from '../ports/session-repository.js'
import type { UserRepository } from '../ports/user-repository.js'
import { revokeUserAccess } from '../services/user-access.js'

export type ReplaceAppError =
  | { kind: 'invalid-organization'; login: string }
  | { kind: 'not-configured' }
  | { kind: 'github-rejected' }

interface Deps {
  config: InstanceConfigRepository
  users: UserRepository
  sessions: SessionRepository
  registrar: AppRegistrar
  /** Forgets what the GitHub adapters remember of the previous App (installations, tokens, lists). */
  forgetGitHubState: () => void
}

/**
 * Replacing the GitHub App from /admin (spec §4.2), checked with GitHub like at setup. User
 * tokens belong to the App that issued them: they are erased and every session ends, the
 * administrator's included. Public URL, organisations, administrators, layouts, manual sources
 * and caches stay; the owner (and its type) is the new App's.
 */
export function makeReplaceApp(deps: Deps) {
  async function replace(app: GitHubAppCredentials): Promise<void> {
    // The App first: whatever the adapters load again from now on uses the new one.
    await deps.config.update({ app })
    deps.forgetGitHubState()
    await revokeUserAccess(deps)
  }

  return {
    async startManifest(input: {
      organization?: string
      state: string
    }): Promise<Result<{ postUrl: string; manifest: AppManifest }, ReplaceAppError>> {
      if (input.organization !== undefined && !isValidOrganizationLogin(input.organization)) {
        return err({ kind: 'invalid-organization', login: input.organization })
      }
      const { publicUrl } = await deps.config.get()
      if (!publicUrl) return err({ kind: 'not-configured' })
      return ok({
        postUrl: manifestPostUrl(input.organization, input.state),
        manifest: buildAppManifest(publicUrl, REPLACE_CALLBACK_PATH),
      })
    },

    async completeManifest(code: string): Promise<Result<void, ReplaceAppError>> {
      const app = await deps.registrar.convertManifest(code)
      if (!app) return err({ kind: 'github-rejected' })
      await replace(app)
      return ok(undefined)
    },

    async saveExistingApp(input: ExistingAppInput): Promise<Result<void, ReplaceAppError>> {
      const app = await deps.registrar.verify(input)
      if (!app) return err({ kind: 'github-rejected' })
      await replace(app)
      return ok(undefined)
    },
  }
}

export type ReplaceApp = ReturnType<typeof makeReplaceApp>
