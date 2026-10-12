import type { AppRegistrar, ExistingAppInput } from '../../src/application/ports/app-registrar.js'
import type {
  GitHubIdentity,
  GitHubProfile,
  OAuthApp,
  OAuthTokens,
} from '../../src/application/ports/github-identity.js'
import type { GitHubAppCredentials } from '../../src/application/ports/instance-config.js'

export const FAKE_APP: GitHubAppCredentials = {
  appId: 42,
  slug: 'repoerd-test',
  name: 'RepoERD test',
  htmlUrl: 'https://github.com/apps/repoerd-test',
  ownerLogin: 'acme',
  ownerType: 'User',
  clientId: 'Iv1.client',
  clientSecret: 'client-secret',
  privateKey: 'pem',
}

export class FakeAppRegistrar implements AppRegistrar {
  readonly validCodes = new Set(['manifest-code'])

  async convertManifest(code: string) {
    return this.validCodes.has(code) ? FAKE_APP : null
  }
  async verify(input: ExistingAppInput) {
    return input.appId === FAKE_APP.appId && input.clientId === FAKE_APP.clientId
      ? { ...FAKE_APP, clientSecret: input.clientSecret, privateKey: input.privateKey }
      : null
  }
}

/** GitHub OAuth stand-in: codes and refresh tokens are looked up in maps. */
export class FakeGitHubIdentity implements GitHubIdentity {
  profile: GitHubProfile = { id: '1', login: 'alice', avatarUrl: null }
  /** Profiles by access token; `profile` for any other token. */
  readonly profiles = new Map<string, GitHubProfile>()
  accounts = ['acme']
  readonly codes = new Map<string, OAuthTokens>()
  readonly refreshes = new Map<string, OAuthTokens>()
  readonly calls = { exchange: 0, refresh: 0 }
  /** When set, refresh() waits for it (to test concurrent requests). */
  refreshGate: Promise<void> | null = null

  authorizeUrl(input: { clientId: string; redirectUri: string; state: string }) {
    return `https://github.test/authorize?${new URLSearchParams({ client_id: input.clientId, redirect_uri: input.redirectUri, state: input.state })}`
  }
  async exchangeCode(_app: OAuthApp, input: { code: string }) {
    this.calls.exchange++
    return this.codes.get(input.code) ?? null
  }
  async refresh(_app: OAuthApp, refreshToken: string) {
    this.calls.refresh++
    await this.refreshGate
    return this.refreshes.get(refreshToken) ?? null
  }
  async getProfile(accessToken: string) {
    return this.profiles.get(accessToken) ?? this.profile
  }
  async listInstallationAccounts() {
    return this.accounts
  }
}
