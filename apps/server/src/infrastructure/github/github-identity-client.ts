import { z } from 'zod'
import type {
  GitHubIdentity,
  GitHubProfile,
  OAuthApp,
  OAuthTokens,
} from '../../application/ports/github-identity.js'
import type { GitHubApi } from './github-api.js'

const tokenResponseSchema = z.union([
  z.object({
    access_token: z.string(),
    expires_in: z.number().optional(),
    refresh_token: z.string().optional(),
    refresh_token_expires_in: z.number().optional(),
  }),
  z.object({ error: z.string() }),
])
const profileSchema = z.object({
  id: z.number(),
  login: z.string(),
  avatar_url: z.string().nullable().optional(),
})
const installationsSchema = z.object({
  installations: z.array(
    z.object({ id: z.number(), account: z.object({ login: z.string() }).nullable() }),
  ),
})

export class GitHubIdentityClient implements GitHubIdentity {
  constructor(
    private readonly api: GitHubApi,
    private readonly now: () => Date = () => new Date(),
  ) {}

  authorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string {
    const query = new URLSearchParams({
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      state: input.state,
    })
    return `${this.api.origins.web}/login/oauth/authorize?${query}`
  }

  exchangeCode(app: OAuthApp, input: { code: string; redirectUri: string }) {
    return this.requestTokens({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    })
  }

  refresh(app: OAuthApp, refreshToken: string) {
    return this.requestTokens({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    })
  }

  async getProfile(accessToken: string): Promise<GitHubProfile> {
    const user = await this.api.json({ path: '/user', token: accessToken }, profileSchema)
    return { id: String(user.id), login: user.login, avatarUrl: user.avatar_url ?? null }
  }

  async listInstallationAccounts(accessToken: string): Promise<string[]> {
    const { items: installations } = await this.api.paginate(
      { path: '/user/installations', token: accessToken },
      installationsSchema,
      (page) => page.installations,
    )
    return [
      ...new Set(
        installations.flatMap((installation) =>
          installation.account ? [installation.account.login] : [],
        ),
      ),
    ]
  }

  /** GitHub answers OAuth errors with a 200 and an `error` field. */
  private async requestTokens(body: Record<string, string>): Promise<OAuthTokens | null> {
    const response = await this.api.json(
      {
        method: 'POST',
        path: `${this.api.origins.web}/login/oauth/access_token`,
        accept: 'application/json',
        body,
      },
      tokenResponseSchema,
    )
    if (!('access_token' in response)) return null
    const now = this.now().getTime()
    const after = (seconds: number | undefined) =>
      seconds === undefined ? null : new Date(now + seconds * 1000)
    return {
      accessToken: response.access_token,
      accessTokenExpiresAt: after(response.expires_in),
      refreshToken: response.refresh_token ?? null,
      refreshTokenExpiresAt: response.refresh_token
        ? after(response.refresh_token_expires_in)
        : null,
    }
  }
}
