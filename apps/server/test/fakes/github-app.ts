import { generateKeyPairSync } from 'node:crypto'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll } from 'vitest'
import type { GitHubAppCredentials } from '../../src/application/ports/instance-config.js'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })

/** Credentials with a real RSA key, so App JWTs can be signed (GitHub is mocked with msw). */
export const TEST_APP: GitHubAppCredentials = {
  appId: 42,
  slug: 'repoerd-test',
  name: 'RepoERD test',
  htmlUrl: 'https://github.com/apps/repoerd-test',
  ownerLogin: 'acme',
  ownerType: 'User',
  clientId: 'Iv1.client',
  clientSecret: 'client-secret',
  privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
}

/** An msw server for the current test file; unhandled requests fail the test. */
export function githubServer() {
  const server = setupServer()
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterEach(() => server.resetHandlers())
  afterAll(() => server.close())
  return server
}

/** The App is installed (installation 7) on `repos` ("owner/name", lower case). */
export function installationHandlers(repos: string[], counter = { tokens: 0 }) {
  return [
    http.get('https://api.github.com/repos/:owner/:repo/installation', ({ params }) =>
      repos.includes(`${params.owner}/${params.repo}`.toLowerCase())
        ? HttpResponse.json({ id: 7 })
        : new HttpResponse(null, { status: 404 }),
    ),
    http.post('https://api.github.com/app/installations/7/access_tokens', () => {
      counter.tokens++
      return HttpResponse.json({
        token: `inst-${counter.tokens}`,
        expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      })
    }),
  ]
}
