import type { UserTokens } from './user-repository.js'

export interface OAuthApp {
  clientId: string
  clientSecret: string
}

export type OAuthTokens = UserTokens

export interface GitHubProfile {
  id: string
  login: string
  avatarUrl: string | null
}

/** GitHub as identity provider, through the App's OAuth (user-to-server tokens). */
export interface GitHubIdentity {
  authorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string
  /** null when GitHub rejects the code (expired, reused, wrong redirect). */
  exchangeCode(
    app: OAuthApp,
    input: { code: string; redirectUri: string },
  ): Promise<OAuthTokens | null>
  /** null when GitHub rejects the refresh token (expired, already used, revoked). */
  refresh(app: OAuthApp, refreshToken: string): Promise<OAuthTokens | null>
  getProfile(accessToken: string): Promise<GitHubProfile>
  /** Logins of the accounts (users, organisations) of the App installations the user can access. */
  listInstallationAccounts(accessToken: string): Promise<string[]>
}
