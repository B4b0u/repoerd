import type { SessionRepository } from '../ports/session-repository.js'
import type { UserRepository } from '../ports/user-repository.js'

export interface RevokedAccess {
  tokensCleared: number
  sessionsDeleted: number
}

/**
 * Users' GitHub tokens belong to the GitHub App that issued them: when the App changes or is
 * forgotten, every token is erased and every session ends. Everyone signs in again; their
 * accounts, rights and layouts stay.
 */
export async function revokeUserAccess(deps: {
  users: Pick<UserRepository, 'clearAllTokens'>
  sessions: Pick<SessionRepository, 'deleteAll'>
}): Promise<RevokedAccess> {
  // Sessions first: a failure in between leaves everyone signed out, and signing in rewrites tokens.
  const sessionsDeleted = await deps.sessions.deleteAll()
  const tokensCleared = await deps.users.clearAllTokens()
  return { tokensCleared, sessionsDeleted }
}
