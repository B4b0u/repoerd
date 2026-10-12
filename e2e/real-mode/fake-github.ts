import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

/** The GitHub App the real-mode test registers as an existing App. */
export const FAKE_APP = {
  id: 424242,
  slug: 'repoerd-e2e',
  name: 'RepoERD E2E',
  owner: 'octo-org',
  clientId: 'Iv1.e2e0000000000000',
  clientSecret: 'e2e-client-secret',
} as const

export const FAKE_USER = { id: 5150, login: 'octo-admin' } as const
export const FAKE_REPO = { id: 9001, owner: 'octo-org', name: 'warehouse' } as const

const INSTALLATION_ID = 77
const OAUTH_CODE = 'e2e-oauth-code'
const ACCESS_TOKEN = 'ghu_e2e_access_token'

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const bearer = (request: IncomingMessage) =>
  (request.headers.authorization ?? '').replace(/^Bearer /, '')

/** The issuer of the App JWT RepoERD signs with the private key it was given (not verified here). */
function appIdOf(jwt: string): number | null {
  const payload = jwt.split('.')[1]
  if (!payload) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      iss?: unknown
    }
    return Number(claims.iss)
  } catch {
    return null
  }
}

async function handle(request: IncomingMessage, response: ServerResponse, port: number) {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
  const signedIn = bearer(request) === ACCESS_TOKEN
  switch (`${request.method} ${url.pathname}`) {
    // OAuth: GitHub would ask the user to authorize the App; the fake one sends them straight back.
    case 'GET /login/oauth/authorize': {
      const redirect = url.searchParams.get('redirect_uri')
      const state = url.searchParams.get('state')
      if (url.searchParams.get('client_id') !== FAKE_APP.clientId || !redirect || !state)
        return json(response, 400, { message: 'Bad authorize request' })
      const back = new URL(redirect)
      back.searchParams.set('code', OAUTH_CODE)
      back.searchParams.set('state', state)
      response.writeHead(302, { location: back.href })
      response.end()
      return
    }
    // GitHub answers OAuth errors with a 200 and an `error` field.
    case 'POST /login/oauth/access_token': {
      const body = JSON.parse(await readBody(request)) as Record<string, string | undefined>
      if (body.client_id !== FAKE_APP.clientId || body.client_secret !== FAKE_APP.clientSecret)
        return json(response, 200, { error: 'incorrect_client_credentials' })
      if (body.code !== OAUTH_CODE && body.grant_type !== 'refresh_token')
        return json(response, 200, { error: 'bad_verification_code' })
      return json(response, 200, {
        access_token: ACCESS_TOKEN,
        expires_in: 28_800,
        refresh_token: 'ghr_e2e_refresh_token',
        refresh_token_expires_in: 15_897_600,
        token_type: 'bearer',
        scope: '',
      })
    }
    case 'GET /app':
      if (appIdOf(bearer(request)) !== FAKE_APP.id)
        return json(response, 401, { message: 'Bad credentials' })
      return json(response, 200, {
        id: FAKE_APP.id,
        slug: FAKE_APP.slug,
        name: FAKE_APP.name,
        html_url: `http://127.0.0.1:${port}/apps/${FAKE_APP.slug}`,
        owner: { login: FAKE_APP.owner, type: 'Organization' },
        client_id: FAKE_APP.clientId,
      })
    case 'GET /user':
      if (!signedIn) return json(response, 401, { message: 'Bad credentials' })
      return json(response, 200, { id: FAKE_USER.id, login: FAKE_USER.login, avatar_url: null })
    case 'GET /user/installations':
      if (!signedIn) return json(response, 401, { message: 'Bad credentials' })
      return json(response, 200, {
        total_count: 1,
        installations: [{ id: INSTALLATION_ID, account: { login: FAKE_APP.owner } }],
      })
    case `GET /user/installations/${INSTALLATION_ID}/repositories`:
      if (!signedIn) return json(response, 401, { message: 'Bad credentials' })
      return json(response, 200, {
        total_count: 1,
        repositories: [
          {
            id: FAKE_REPO.id,
            name: FAKE_REPO.name,
            owner: { login: FAKE_REPO.owner },
            default_branch: 'main',
            private: true,
            permissions: { push: true },
          },
        ],
      })
    default:
      return json(response, 404, { message: 'Not Found' })
  }
}

/** The GitHub endpoints of setup (existing App), sign-in and repository visibility, on loopback. */
export function startFakeGitHub(port: number): Promise<Server> {
  const server = createServer((request, response) => {
    handle(request, response, port).catch(() =>
      json(response, 500, { message: 'Fake GitHub failed' }),
    )
  })
  return new Promise((resolve, reject) => {
    // A port already taken must fail the run, not leave it waiting.
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(server)
    })
  })
}
