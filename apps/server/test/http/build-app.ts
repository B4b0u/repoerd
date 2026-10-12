import { MUTATION_HEADER } from '@repoerd/contracts'
import { makeBlobReader } from '../../src/application/services/blob-reader.js'
import { makeCommitSchemas } from '../../src/application/services/commit-schemas.js'
import { makeAdmin } from '../../src/application/use-cases/admin.js'
import { makeAuth } from '../../src/application/use-cases/auth.js'
import { makeCompareBranchSchemas } from '../../src/application/use-cases/compare-branch-schemas.js'
import type { GetBranchSchema } from '../../src/application/use-cases/get-branch-schema.js'
import { makeGetBranchSchema } from '../../src/application/use-cases/get-branch-schema.js'
import { makeGetLayout, makeSaveTablePositions } from '../../src/application/use-cases/layouts.js'
import { makeListBranches } from '../../src/application/use-cases/list-branches.js'
import { makeReplaceApp } from '../../src/application/use-cases/replace-app.js'
import { makeRepoAccess } from '../../src/application/use-cases/repo-access.js'
import { makeRepoSettings } from '../../src/application/use-cases/repo-settings.js'
import { makeSetup } from '../../src/application/use-cases/setup.js'
import {
  createRateLimiter,
  type RateLimiter,
  USER_REQUESTS_PER_MINUTE,
} from '../../src/domain/rate-limit.js'
import { createApp } from '../../src/http/app.js'
import type { CommonDeps } from '../../src/http/types.js'
import { FAKE_APP, FakeAppRegistrar, FakeGitHubIdentity } from '../fakes/fake-github.js'
import { FakeTokenService } from '../fakes/fake-tokens.js'
import { InMemoryGitHost } from '../fakes/in-memory-git-host.js'
import { accessible, InMemoryRepoDirectory } from '../fakes/in-memory-repo-directory.js'
import {
  InMemoryBlobCache,
  InMemoryInstanceConfig,
  InMemoryLayoutRepository,
  InMemoryRepoSettings,
  InMemorySchemaCache,
  InMemorySessionRepository,
  InMemoryUserRepository,
} from '../fakes/in-memory-stores.js'
import { StubSchemaToolkit } from '../fakes/stub-schema-toolkit.js'

/** A branch name GitHub allows that still needs encoding: slash, #, + and an accent. */
export const ODD_BRANCH = 'feature/odd#1+é'
export const NOW = new Date('2026-10-10T12:00:00Z')
export const DAY = 24 * 3600_000

interface Options {
  getBranchSchema?: GetBranchSchema
  /** Merge bases of the in-memory host (see InMemoryGitHost). */
  mergeBases?: Record<string, string | null>
  /** Serve a web build from this folder (default: the web is not served). */
  webDistPath?: string
  /** Real mode: the per-user limit (default: 60 a minute, real clock). */
  userRateLimit?: RateLimiter
  /** The database ping of /healthz (default: always answers). */
  checkDatabase?: () => void
}

/** acme/shop is visible (with write access); acme/secret exists on the host but is not visible. */
function common(
  config: InMemoryInstanceConfig,
  users: InMemoryUserRepository,
  sessions: InMemorySessionRepository,
  now: () => Date,
  options: Options,
) {
  const gitHost = new InMemoryGitHost(
    [
      {
        owner: 'acme',
        name: 'shop',
        branches: {
          main: { 'prisma/schema.prisma': 'users' },
          [ODD_BRANCH]: { 'prisma/schema.prisma': 'reviews' },
        },
      },
      { owner: 'acme', name: 'secret', branches: { main: { 'prisma/schema.prisma': 'salaries' } } },
    ],
    { mergeBases: options.mergeBases },
  )
  const directory = new InMemoryRepoDirectory([accessible('acme', 'shop', true)])
  const layouts = new InMemoryLayoutRepository()
  const settings = new InMemoryRepoSettings()
  const logged: object[] = []
  const warned: object[] = []
  const commitSchemas = makeCommitSchemas({
    gitHost,
    toolkit: new StubSchemaToolkit(),
    schemaCache: new InMemorySchemaCache(),
    readBlobs: makeBlobReader({ gitHost, blobCache: new InMemoryBlobCache() }),
  })
  const deps: CommonDeps = {
    repoAccess: makeRepoAccess({ directory, config }),
    listBranches: makeListBranches({ gitHost }),
    getBranchSchema:
      options.getBranchSchema ?? makeGetBranchSchema({ gitHost, settings, commitSchemas }),
    compareBranchSchemas: makeCompareBranchSchemas({ gitHost, settings, commitSchemas }),
    getLayout: makeGetLayout({ layouts }),
    saveTablePositions: makeSaveTablePositions({ layouts }),
    repoSettings: makeRepoSettings({ settings }),
    admin: makeAdmin({ config, users, directory, sessions, now }),
    logger: {
      error: (details) => logged.push(details),
      warn: (details, message) => warned.push({ ...details, message }),
    },
    version: 'test',
    checkDatabase: options.checkDatabase ?? (() => {}),
    webDistPath: options.webDistPath ?? null,
  }
  return { deps, directory, logged, warned, settings }
}

export function buildFakeModeApp(options: Options = {}) {
  const users = new InMemoryUserRepository()
  users.users.set('fake-user', { id: 'fake-user', login: 'dev', avatarUrl: null, isAdmin: true })
  const { deps, directory, logged, warned, settings } = common(
    new InMemoryInstanceConfig(),
    users,
    new InMemorySessionRepository(),
    () => NOW,
    options,
  )
  const app = createApp({
    ...deps,
    mode: 'fake',
    fakeUser: { id: 'fake-user', login: 'dev', avatarUrl: null, isAdmin: true },
  })
  return { app, directory, logged, warned, settings, users }
}

/** Real mode with in-memory stores. `ready: false` starts from a fresh, unconfigured instance. */
export function buildRealModeApp(options: Options & { ready?: boolean } = {}) {
  const config = new InMemoryInstanceConfig()
  const users = new InMemoryUserRepository()
  const sessions = new InMemorySessionRepository()
  const tokens = new FakeTokenService()
  const identity = new FakeGitHubIdentity()
  let clock = NOW
  const now = () => clock
  if (options.ready !== false) {
    config.config = { ...config.config, publicUrl: 'https://erd.example.com', app: FAKE_APP }
    users.users.set('admin', { id: 'admin', login: 'admin', avatarUrl: null, isAdmin: true })
  }
  const { deps, directory, logged, warned, settings } = common(
    config,
    users,
    sessions,
    now,
    options,
  )
  const registrar = new FakeAppRegistrar()
  const setup = makeSetup({ config, users, tokens, registrar, now })
  const auth = makeAuth({ config, users, sessions, identity, tokens, now })
  let forgotten = 0
  const replaceApp = makeReplaceApp({
    config,
    users,
    sessions,
    registrar,
    forgetGitHubState: () => {
      forgotten++
    },
  })
  const app = createApp({
    ...deps,
    mode: 'real',
    setup,
    auth,
    replaceApp,
    randomToken: () => tokens.random(),
    userRateLimit:
      options.userRateLimit ??
      createRateLimiter({ limit: USER_REQUESTS_PER_MINUTE, windowMs: 60_000 }),
  })

  /** A signed-in browser: returns its Cookie header. */
  async function signIn(userId = '1', login = 'alice') {
    await users.upsert({ id: userId, login, avatarUrl: null })
    const token = `session-${userId}`
    await sessions.create({
      idHash: tokens.hash(token),
      userId,
      expiresAt: new Date(clock.getTime() + 30 * DAY),
      lastSeenAt: clock,
      createdAt: clock,
    })
    return `repoerd_session=${token}`
  }

  return {
    app,
    config,
    users,
    sessions,
    tokens,
    identity,
    registrar,
    directory,
    settings,
    setup,
    logged,
    warned,
    signIn,
    /** How many times the GitHub adapters were told to forget the previous App. */
    forgotten: () => forgotten,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms)
    },
  }
}

/** name → value of every Set-Cookie of a response (an empty value means "cleared"). */
export function cookiesFrom(response: Response): Record<string, string> {
  return Object.fromEntries(
    response.headers.getSetCookie().map((line) => {
      const [pair = ''] = line.split(';')
      const at = pair.indexOf('=')
      return [pair.slice(0, at), pair.slice(at + 1)]
    }),
  )
}

export function jsonRequest(
  method: 'POST' | 'PUT' | 'PATCH',
  body: unknown,
  cookie?: string,
): RequestInit {
  return {
    method,
    headers: {
      'content-type': 'application/json',
      [MUTATION_HEADER]: '1',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  }
}
