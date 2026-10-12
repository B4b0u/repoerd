import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { defaultParserPool } from '@repoerd/schema-core'
import { pino } from 'pino'
import type { GitHost } from './application/ports/git-host.js'
import type { RepoDirectory } from './application/ports/repo-directory.js'
import { makeBlobReader } from './application/services/blob-reader.js'
import { makeCommitSchemas } from './application/services/commit-schemas.js'
import { makeAdmin } from './application/use-cases/admin.js'
import { makeAuth, makeUserAccessToken } from './application/use-cases/auth.js'
import { makeCompareBranchSchemas } from './application/use-cases/compare-branch-schemas.js'
import { makeGetBranchSchema } from './application/use-cases/get-branch-schema.js'
import { makeGetLayout, makeSaveTablePositions } from './application/use-cases/layouts.js'
import { makeListBranches } from './application/use-cases/list-branches.js'
import { makeReplaceApp } from './application/use-cases/replace-app.js'
import { makeRepoAccess } from './application/use-cases/repo-access.js'
import { makeRepoSettings } from './application/use-cases/repo-settings.js'
import { makeSetup } from './application/use-cases/setup.js'
import { loadConfig } from './config.js'
import { createRateLimiter, USER_REQUESTS_PER_MINUTE } from './domain/rate-limit.js'
import { createApp } from './http/app.js'
import type { CurrentUser } from './http/current-user.js'
import type { CommonDeps } from './http/types.js'
import { createSecretBox } from './infrastructure/crypto/secret-box.js'
import { nodeTokenService } from './infrastructure/crypto/tokens.js'
import { FixtureGitHost } from './infrastructure/fake-github/fixture-git-host.js'
import { FixtureRepoDirectory } from './infrastructure/fake-github/fixture-repo-directory.js'
import { GitHubApi, githubOrigins } from './infrastructure/github/github-api.js'
import { GitHubAppRegistrar } from './infrastructure/github/github-app-registrar.js'
import { GitHubGitHost } from './infrastructure/github/github-git-host.js'
import { GitHubIdentityClient } from './infrastructure/github/github-identity-client.js'
import { GitHubRepoDirectory } from './infrastructure/github/github-repo-directory.js'
import { InstallationTokens } from './infrastructure/github/installation-tokens.js'
import { purgeCaches } from './infrastructure/persistence/cache-retention.js'
import { openDatabase, pingDatabase } from './infrastructure/persistence/database.js'
import { SqliteBlobCache } from './infrastructure/persistence/sqlite-blob-cache.js'
import { SqliteInstanceConfigRepository } from './infrastructure/persistence/sqlite-instance-config-repository.js'
import { SqliteLayoutRepository } from './infrastructure/persistence/sqlite-layout-repository.js'
import { SqliteLegacyRepoKeys } from './infrastructure/persistence/sqlite-legacy-repo-keys.js'
import { SqliteRepoSettingsRepository } from './infrastructure/persistence/sqlite-repo-settings-repository.js'
import { SqliteSchemaCache } from './infrastructure/persistence/sqlite-schema-cache.js'
import { SqliteSessionRepository } from './infrastructure/persistence/sqlite-session-repository.js'
import { SqliteUserRepository } from './infrastructure/persistence/sqlite-user-repository.js'
import { schemaCoreToolkit } from './infrastructure/schema/schema-core-toolkit.js'
import { makeShutdown } from './shutdown.js'
import {
  checkAppGitHubOrigin,
  checkStoredSecrets,
  claimInstanceMode,
  DEMO_MODE_WARNING,
  forgetAccessWithoutApp,
  insecurePublicUrlWarning,
} from './startup-checks.js'
import { resolveWebBuild } from './web-build.js'

// Same relative depth from src/ and dist/.
const DEFAULT_FIXTURES = fileURLToPath(new URL('../../../fixtures/repos', import.meta.url))
// Same relative depth from src/ and dist/: apps/server/{src,dist} → apps/web/dist
const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url))
const FAKE_USER: CurrentUser = { id: 'fake-user', login: 'dev', avatarUrl: null, isAdmin: true }
const DAY_MS = 24 * 3600_000

async function main() {
  const config = loadConfig(process.env)
  const logger = pino()
  const webDistPath = resolveWebBuild(config.webDistPath, DEFAULT_WEB_DIST, (message) =>
    logger.info(message),
  )
  const now = () => new Date()

  const { db, close: closeDatabase } = openDatabase(config.databasePath)
  const box = createSecretBox(config.secretKey)
  const users = new SqliteUserRepository(db, box)
  const instanceConfig = new SqliteInstanceConfigRepository(db, box)
  await checkStoredSecrets(instanceConfig)
  await claimInstanceMode(instanceConfig, config.githubMode)
  await checkAppGitHubOrigin(instanceConfig, config.githubTestOrigin)
  const sessions = new SqliteSessionRepository(db)
  const layouts = new SqliteLayoutRepository(db)
  const repoSettings = new SqliteRepoSettingsRepository(db)
  // Rows saved by repository name before plan 6d move to the repository's id on access.
  const legacyKeys = new SqliteLegacyRepoKeys(db)
  const schemaCache = new SqliteSchemaCache(db)
  const blobCache = new SqliteBlobCache(db)
  const purgeCachedRows = () => {
    try {
      const deleted = purgeCaches({ schemas: schemaCache, blobs: blobCache }, now())
      if (deleted > 0)
        logger.info(`Deleted ${deleted} cached rows (older than 30 days or outdated)`)
    } catch (error) {
      logger.error({ err: error }, 'Could not purge the caches')
    }
  }
  purgeCachedRows()
  setInterval(purgeCachedRows, DAY_MS).unref()

  const common = (
    gitHost: GitHost,
    directory: RepoDirectory,
    { enforceAllowedOrgs }: { enforceAllowedOrgs: boolean },
  ): CommonDeps => {
    // One instance: /schema and /compare requests for the same commit share their parses.
    const commitSchemas = makeCommitSchemas({
      gitHost,
      toolkit: schemaCoreToolkit,
      schemaCache,
      readBlobs: makeBlobReader({ gitHost, blobCache }),
    })
    return {
      repoAccess: makeRepoAccess({
        directory,
        config: instanceConfig,
        enforceAllowedOrgs,
        legacyKeys,
      }),
      listBranches: makeListBranches({ gitHost }),
      getBranchSchema: makeGetBranchSchema({ gitHost, settings: repoSettings, commitSchemas }),
      compareBranchSchemas: makeCompareBranchSchemas({
        gitHost,
        settings: repoSettings,
        commitSchemas,
      }),
      getLayout: makeGetLayout({ layouts }),
      saveTablePositions: makeSaveTablePositions({ layouts }),
      repoSettings: makeRepoSettings({ settings: repoSettings }),
      admin: makeAdmin({ config: instanceConfig, users, directory, sessions, now }),
      logger,
      version: config.version,
      checkDatabase: () => pingDatabase(db),
      webDistPath,
    }
  }

  let app: ReturnType<typeof createApp>
  if (config.githubMode === 'fake') {
    logger.warn(DEMO_MODE_WARNING)
    await users.upsert(FAKE_USER)
    await users.setAdmin(FAKE_USER.id, true)
    const gitHost = new FixtureGitHost(config.fixturesPath ?? DEFAULT_FIXTURES)
    app = createApp({
      ...common(gitHost, new FixtureRepoDirectory(gitHost), { enforceAllowedOrgs: false }),
      mode: 'fake',
      fakeUser: FAKE_USER,
    })
  } else {
    const testOrigin = config.githubTestOrigin
    if (testOrigin)
      logger.warn(`REPOERD_TEST_GITHUB_URL is set: GitHub is ${testOrigin} (tests only)`)
    const api = new GitHubApi(undefined, undefined, githubOrigins(testOrigin))
    const installations = new InstallationTokens({
      api,
      credentials: async () => (await instanceConfig.get()).app,
    })
    const identity = new GitHubIdentityClient(api)
    const accessToken = makeUserAccessToken({
      config: instanceConfig,
      users,
      sessions,
      identity,
      now,
    })
    const announceCode = (code: string) =>
      logger.info(
        `RepoERD is not configured yet. Open /setup and enter the one-time setup code: ${code}`,
      )
    const registrar = new GitHubAppRegistrar(api)
    const setup = makeSetup({
      config: instanceConfig,
      users,
      tokens: nodeTokenService,
      registrar,
      now,
    })
    const auth = makeAuth({
      config: instanceConfig,
      users,
      sessions,
      identity,
      tokens: nodeTokenService,
      now,
    })
    const directory = new GitHubRepoDirectory({ api, accessToken, logger })
    const replaceApp = makeReplaceApp({
      config: instanceConfig,
      users,
      sessions,
      registrar,
      // The previous App's installations, tokens and visible repositories mean nothing to the new one.
      forgetGitHubState: () => {
        installations.forgetAll()
        directory.forgetAll()
      },
    })
    app = createApp({
      ...common(new GitHubGitHost({ api, installations, logger }), directory, {
        enforceAllowedOrgs: true,
      }),
      mode: 'real',
      setup,
      auth,
      replaceApp,
      randomToken: nodeTokenService.random,
      userRateLimit: createRateLimiter({ limit: USER_REQUESTS_PER_MINUTE, windowMs: 60_000 }),
    })
    const insecure = insecurePublicUrlWarning((await instanceConfig.get()).publicUrl)
    if (insecure) logger.warn(insecure)
    const forgotten = await forgetAccessWithoutApp({ config: instanceConfig, users, sessions })
    if (forgotten.tokensCleared + forgotten.sessionsDeleted > 0) {
      logger.info(
        `No GitHub App configured: signed everybody out (${forgotten.sessionsDeleted} sessions, GitHub tokens of ${forgotten.tokensCleared} users)`,
      )
    }
    // Spec §8: the one-time setup code is the only secret ever written to the logs.
    const code = await setup.issueCode()
    if (code) announceCode(code)
    const purgeSessions = () =>
      auth.purgeExpiredSessions().then(
        (count) => count > 0 && logger.info(`Deleted ${count} expired sessions`),
        (error: unknown) => logger.error({ err: error }, 'Could not delete expired sessions'),
      )
    await purgeSessions()
    setInterval(() => void purgeSessions(), DAY_MS).unref()
  }

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info(
      `RepoERD API listening on http://localhost:${info.port} (GITHUB_MODE=${config.githubMode})`,
    )
  })
  const shutdown = makeShutdown({
    server,
    closeParsers: () => defaultParserPool().close(),
    closeDatabase,
    logger,
    exit: (code) => process.exit(code),
  })
  process.once('SIGTERM', () => shutdown('SIGTERM'))
  process.once('SIGINT', () => shutdown('SIGINT'))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
