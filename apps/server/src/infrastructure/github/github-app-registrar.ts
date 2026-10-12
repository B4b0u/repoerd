import { z } from 'zod'
import type { AppRegistrar, ExistingAppInput } from '../../application/ports/app-registrar.js'
import type { GitHubAppCredentials } from '../../application/ports/instance-config.js'
import { createAppJwt } from './app-jwt.js'
import type { GitHubApi } from './github-api.js'

const appSchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  html_url: z.string(),
  owner: z.object({ login: z.string(), type: z.string().optional() }).nullable(),
  client_id: z.string(),
})
const conversionSchema = appSchema.extend({ client_secret: z.string(), pem: z.string() })

type GitHubApp = z.infer<typeof appSchema>

const credentials = (
  app: GitHubApp,
  clientSecret: string,
  privateKey: string,
): GitHubAppCredentials => ({
  appId: app.id,
  slug: app.slug,
  name: app.name,
  htmlUrl: app.html_url,
  // GitHub may omit the owner; the login is only displayed, so an empty string is harmless.
  ownerLogin: app.owner?.login ?? '',
  ownerType: app.owner?.type === 'Organization' ? 'Organization' : 'User',
  clientId: app.client_id,
  clientSecret,
  privateKey,
})

/** A 4xx means GitHub refused what we sent (expired code, wrong credentials); 5xx throw. */
const refused = (response: Response) => response.status >= 400 && response.status < 500

export class GitHubAppRegistrar implements AppRegistrar {
  constructor(
    private readonly api: GitHubApi,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async convertManifest(code: string): Promise<GitHubAppCredentials | null> {
    const request = {
      method: 'POST' as const,
      path: `/app-manifests/${encodeURIComponent(code)}/conversions`,
      // The code is a secret: errors and logs never show it.
      label: '/app-manifests/{code}/conversions',
    }
    const response = await this.api.send(request)
    if (refused(response)) return null
    const app = conversionSchema.parse(await this.api.readJson(request, response))
    return credentials(app, app.client_secret, app.pem)
  }

  async verify(input: ExistingAppInput): Promise<GitHubAppCredentials | null> {
    let jwt: string
    try {
      jwt = createAppJwt(input.appId, input.privateKey, this.now())
    } catch {
      return null
    }
    const request = { path: '/app', token: jwt }
    const response = await this.api.send(request)
    if (refused(response)) return null
    const app = appSchema.parse(await this.api.readJson(request, response))
    if (app.id !== input.appId || app.client_id !== input.clientId) return null
    return credentials(app, input.clientSecret, input.privateKey)
  }
}
