/** A token expiring within this margin is refreshed before use. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000

export type TokenAction = 'use' | 'refresh' | 'reauth'

export function tokenAction(
  tokens: {
    accessTokenExpiresAt: Date | null
    refreshToken: string | null
    refreshTokenExpiresAt: Date | null
  },
  now: Date,
): TokenAction {
  if (!tokens.accessTokenExpiresAt) return 'use'
  if (tokens.accessTokenExpiresAt.getTime() - now.getTime() > TOKEN_REFRESH_MARGIN_MS) return 'use'
  const refreshable =
    tokens.refreshToken !== null &&
    (tokens.refreshTokenExpiresAt === null ||
      tokens.refreshTokenExpiresAt.getTime() > now.getTime())
  return refreshable ? 'refresh' : 'reauth'
}
