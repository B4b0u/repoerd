import { createRateLimiter, SETUP_FAILURES_PER_MINUTE } from '../../domain/rate-limit.js'
import { err, ok, type Result } from '../../domain/result.js'
import { isExpired } from '../../domain/session.js'
import {
  type AppManifest,
  buildAppManifest,
  installUrl,
  isValidOrganizationLogin,
  manifestPostUrl,
  normalizePublicUrl,
  normalizeSetupCode,
  SETUP_GRANT_LIFETIME_MS,
  type SetupState,
  setupState,
} from '../../domain/setup.js'
import type { AppRegistrar, ExistingAppInput } from '../ports/app-registrar.js'
import type { InstanceConfig, InstanceConfigRepository } from '../ports/instance-config.js'
import type { TokenService } from '../ports/tokens.js'
import type { UserRepository } from '../ports/user-repository.js'

export type SetupError =
  | { kind: 'invalid-code' }
  | { kind: 'invalid-grant' }
  | { kind: 'already-configured' }
  | { kind: 'invalid-public-url' }
  | { kind: 'invalid-organization'; login: string }
  | { kind: 'github-rejected' }
  | { kind: 'too-many-attempts'; retryAfterSeconds: number }

export interface SetupStatus {
  state: SetupState
  /** This browser holds a valid setup grant. */
  unlocked: boolean
  publicUrl: string | null
  app: { name: string; htmlUrl: string; installUrl: string } | null
}

interface Deps {
  config: InstanceConfigRepository
  users: UserRepository
  tokens: TokenService
  registrar: AppRegistrar
  now: () => Date
}

export function isGrantValid(
  config: InstanceConfig,
  grant: string | undefined,
  tokens: TokenService,
  now: Date,
): boolean {
  if (!grant || !config.setupGrant || isExpired(config.setupGrant.expiresAt, now)) return false
  return tokens.sameHash(tokens.hash(grant), config.setupGrant.hash)
}

export function makeSetup(deps: Deps) {
  // The code never changes on failures (59 bits): wrong codes are only slowed down, for the whole
  // instance, and the right code is always accepted, so a flood cannot lock the operator out.
  const wrongCodes = createRateLimiter({
    limit: SETUP_FAILURES_PER_MINUTE,
    windowMs: 60_000,
    now: () => deps.now().getTime(),
  })

  async function current() {
    const config = await deps.config.get()
    const state = setupState({
      hasApp: config.app !== null,
      adminCount: await deps.users.countAdmins(),
    })
    return { config, state }
  }

  /** Every setup change needs an unfinished setup and a browser that entered the code. */
  async function authorize(grant: string | undefined): Promise<Result<InstanceConfig, SetupError>> {
    const { config, state } = await current()
    if (state === 'ready') return err({ kind: 'already-configured' })
    if (!isGrantValid(config, grant, deps.tokens, deps.now())) return err({ kind: 'invalid-grant' })
    return ok(config)
  }

  /** Re-checked after awaiting GitHub: the first administrator may have signed in meanwhile. */
  async function becameReady(): Promise<boolean> {
    return (await current()).state === 'ready'
  }

  /**
   * After `repoerd-admin reset-app` the administrators remain: saving the App makes the instance
   * ready at once, so the setup code and grant are spent.
   */
  async function saveApp(patch: Partial<InstanceConfig>): Promise<void> {
    await deps.config.update(patch)
    if (await becameReady()) await deps.config.update({ setupCodeHash: null, setupGrant: null })
  }

  async function issueCode(): Promise<string | null> {
    const { state } = await current()
    if (state === 'ready') {
      await deps.config.update({ setupCodeHash: null })
      return null
    }
    const code = deps.tokens.setupCode()
    await deps.config.update({ setupCodeHash: deps.tokens.hash(normalizeSetupCode(code)) })
    return code
  }

  return {
    async status(grant?: string): Promise<SetupStatus> {
      const { config, state } = await current()
      return {
        state,
        unlocked: state !== 'ready' && isGrantValid(config, grant, deps.tokens, deps.now()),
        publicUrl: config.publicUrl,
        app: config.app
          ? {
              name: config.app.name,
              htmlUrl: config.app.htmlUrl,
              installUrl: installUrl(config.app.htmlUrl),
            }
          : null,
      }
    },

    /** Called at startup: a fresh code while setup is unfinished, null (and no code) once ready. */
    issueCode,

    async unlock(code: string): Promise<Result<{ grant: string; expiresAt: Date }, SetupError>> {
      const { config, state } = await current()
      if (state === 'ready') return err({ kind: 'already-configured' })
      const hash = deps.tokens.hash(normalizeSetupCode(code))
      if (!config.setupCodeHash || !deps.tokens.sameHash(hash, config.setupCodeHash)) {
        const decision = wrongCodes('setup')
        return err(
          decision.allowed
            ? { kind: 'invalid-code' }
            : { kind: 'too-many-attempts', retryAfterSeconds: decision.retryAfterSeconds },
        )
      }
      const grant = deps.tokens.random()
      const expiresAt = new Date(deps.now().getTime() + SETUP_GRANT_LIFETIME_MS)
      await deps.config.update({ setupGrant: { hash: deps.tokens.hash(grant), expiresAt } })
      return ok({ grant, expiresAt })
    },

    async startManifest(input: {
      grant?: string
      publicUrl: string
      organization?: string
      state: string
    }): Promise<Result<{ postUrl: string; manifest: AppManifest }, SetupError>> {
      const allowed = await authorize(input.grant)
      if (!allowed.ok) return allowed
      const publicUrl = normalizePublicUrl(input.publicUrl)
      if (!publicUrl.ok) return publicUrl
      if (input.organization !== undefined && !isValidOrganizationLogin(input.organization)) {
        return err({ kind: 'invalid-organization', login: input.organization })
      }
      await deps.config.update({ publicUrl: publicUrl.value })
      return ok({
        postUrl: manifestPostUrl(input.organization, input.state),
        manifest: buildAppManifest(publicUrl.value),
      })
    },

    async completeManifest(input: {
      grant?: string
      code: string
    }): Promise<Result<void, SetupError>> {
      const allowed = await authorize(input.grant)
      if (!allowed.ok) return allowed
      if (!allowed.value.publicUrl) return err({ kind: 'invalid-public-url' })
      const app = await deps.registrar.convertManifest(input.code)
      if (!app) return err({ kind: 'github-rejected' })
      if (await becameReady()) return err({ kind: 'already-configured' })
      await saveApp({ app })
      return ok(undefined)
    },

    async saveExistingApp(
      input: { grant?: string; publicUrl: string } & ExistingAppInput,
    ): Promise<Result<void, SetupError>> {
      const allowed = await authorize(input.grant)
      if (!allowed.ok) return allowed
      const publicUrl = normalizePublicUrl(input.publicUrl)
      if (!publicUrl.ok) return publicUrl
      const app = await deps.registrar.verify({
        appId: input.appId,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        privateKey: input.privateKey,
      })
      if (!app) return err({ kind: 'github-rejected' })
      if (await becameReady()) return err({ kind: 'already-configured' })
      await saveApp({ publicUrl: publicUrl.value, app })
      return ok(undefined)
    },
  }
}

export type Setup = ReturnType<typeof makeSetup>
