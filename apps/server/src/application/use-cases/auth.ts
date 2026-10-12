import { isAllowedByOrgs } from '../../domain/orgs.js'
import { err, ok, type Result } from '../../domain/result.js'
import { isExpired, isPastMaxAge, sessionExpiresAt, shouldTouch } from '../../domain/session.js'
import { oauthCallbackUrl } from '../../domain/setup.js'
import { tokenAction } from '../../domain/user-token.js'
import type { GitHubIdentity } from '../ports/github-identity.js'
import type { InstanceConfigRepository } from '../ports/instance-config.js'
import type { SessionRepository } from '../ports/session-repository.js'
import type { TokenService } from '../ports/tokens.js'
import type { AppUser, UserRepository } from '../ports/user-repository.js'
import { isGrantValid } from './setup.js'

export type SignInError =
  | { kind: 'not-configured' }
  | { kind: 'invalid-code' }
  | { kind: 'org-not-allowed' }

export interface SignedIn {
  /** Raw session token, for the cookie only (the database keeps its hash). */
  session: string
  expiresAt: Date
  user: AppUser
}

export interface ResolvedSession {
  user: AppUser
  /** Set when the session was renewed: the cookie must be re-sent with this expiry. */
  renewedExpiresAt: Date | null
}

interface Deps {
  config: InstanceConfigRepository
  users: UserRepository
  sessions: SessionRepository
  identity: GitHubIdentity
  tokens: TokenService
  now: () => Date
}

export function makeAuth(deps: Deps) {
  return {
    /** Deletes the sessions expired or created more than 90 days ago; returns how many. */
    purgeExpiredSessions: () => deps.sessions.deleteExpired(deps.now()),

    async beginSignIn(state: string): Promise<Result<{ url: string }, SignInError>> {
      const { app, publicUrl } = await deps.config.get()
      if (!app || !publicUrl) return err({ kind: 'not-configured' })
      return ok({
        url: deps.identity.authorizeUrl({
          clientId: app.clientId,
          redirectUri: oauthCallbackUrl(publicUrl),
          state,
        }),
      })
    },

    async completeSignIn(input: {
      code: string
      setupGrant?: string
    }): Promise<Result<SignedIn, SignInError>> {
      const config = await deps.config.get()
      if (!config.app || !config.publicUrl) return err({ kind: 'not-configured' })
      const tokens = await deps.identity.exchangeCode(config.app, {
        code: input.code,
        redirectUri: oauthCallbackUrl(config.publicUrl),
      })
      if (!tokens) return err({ kind: 'invalid-code' })
      if (config.allowedOrgs.length > 0) {
        const accounts = await deps.identity.listInstallationAccounts(tokens.accessToken)
        if (!isAllowedByOrgs(config.allowedOrgs, accounts)) return err({ kind: 'org-not-allowed' })
      }

      const profile = await deps.identity.getProfile(tokens.accessToken)
      await deps.users.upsert(profile)
      await deps.users.saveTokens(profile.id, tokens)

      const now = deps.now()
      await deps.users.recordActivity(profile.id, now)
      // Setup step 5: the person who configured the instance becomes its first administrator.
      if (
        isGrantValid(config, input.setupGrant, deps.tokens, now) &&
        (await deps.users.promoteFirstAdmin(profile.id))
      ) {
        await deps.config.update({ setupGrant: null, setupCodeHash: null })
      }

      const session = deps.tokens.random()
      const expiresAt = sessionExpiresAt(now)
      await deps.sessions.create({
        idHash: deps.tokens.hash(session),
        userId: profile.id,
        expiresAt,
        lastSeenAt: now,
        createdAt: now,
      })
      const user = await deps.users.get(profile.id)
      if (!user) throw new Error(`User ${profile.id} disappeared during sign-in`)
      return ok({ session, expiresAt, user })
    },

    async resolveSession(token: string | undefined): Promise<ResolvedSession | null> {
      if (!token) return null
      const idHash = deps.tokens.hash(token)
      const session = await deps.sessions.find(idHash)
      if (!session) return null
      const now = deps.now()
      if (isExpired(session.expiresAt, now) || isPastMaxAge(session.createdAt, now)) {
        await deps.sessions.delete(idHash)
        return null
      }
      const user = await deps.users.get(session.userId)
      if (!user) {
        await deps.sessions.delete(idHash)
        return null
      }
      if (!shouldTouch(session.lastSeenAt, now)) return { user, renewedExpiresAt: null }
      const renewedExpiresAt = sessionExpiresAt(now, session.createdAt)
      await deps.sessions.touch(idHash, now, renewedExpiresAt)
      // Renewed at most once a day: the last activity is known to the day.
      await deps.users.recordActivity(user.id, now)
      return { user, renewedExpiresAt }
    },

    async signOut(token: string | undefined): Promise<void> {
      if (token) await deps.sessions.delete(deps.tokens.hash(token))
    },
  }
}

export type Auth = ReturnType<typeof makeAuth>

/** The user's GitHub token, refreshed when it expires within 5 minutes; null = sign in again. */
export type UserAccessToken = (userId: string) => Promise<string | null>

export function makeUserAccessToken(
  deps: Pick<Deps, 'config' | 'users' | 'sessions' | 'identity' | 'now'>,
): UserAccessToken {
  // GitHub refresh tokens are single-use: concurrent requests of one user share one refresh.
  const inFlight = new Map<string, Promise<string | null>>()

  async function resolve(userId: string): Promise<string | null> {
    const tokens = await deps.users.getTokens(userId)
    if (!tokens) return null
    const action = tokenAction(tokens, deps.now())
    if (action === 'use') return tokens.accessToken
    const { app } = await deps.config.get()
    if (action === 'reauth' || !app || !tokens.refreshToken) {
      await deps.users.saveTokens(userId, null)
      return null
    }
    const refreshed = await deps.identity.refresh(app, tokens.refreshToken)
    await deps.users.saveTokens(userId, refreshed)
    // GitHub refused the refresh (authorisation revoked, account removed): sign out everywhere.
    if (!refreshed) await deps.sessions.deleteForUser(userId)
    return refreshed?.accessToken ?? null
  }

  return (userId) => {
    const pending = inFlight.get(userId)
    if (pending) return pending
    const request = resolve(userId).finally(() => inFlight.delete(userId))
    inFlight.set(userId, request)
    return request
  }
}
