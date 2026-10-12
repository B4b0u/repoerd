import { describe, expect, it } from 'vitest'
import { createSecretBox } from '../src/infrastructure/crypto/secret-box.js'
import { openDatabase } from '../src/infrastructure/persistence/database.js'
import { SqliteInstanceConfigRepository } from '../src/infrastructure/persistence/sqlite-instance-config-repository.js'
import {
  checkAppGitHubOrigin,
  checkStoredSecrets,
  claimInstanceMode,
  forgetAccessWithoutApp,
  insecurePublicUrlWarning,
  SECRET_KEY_MISMATCH,
  StartupError,
} from '../src/startup-checks.js'
import { FAKE_APP } from './fakes/fake-github.js'
import {
  InMemoryInstanceConfig,
  InMemorySessionRepository,
  InMemoryUserRepository,
} from './fakes/in-memory-stores.js'

const KEY = 'Kq3vR8wZt1Yp6Nf2Lh9Xc4Bj7Md0Gs5A'
const OTHER_KEY = 'Zt1Yp6Nf2Lh9Xc4Bj7Md0Gs5AKq3vR8w'

describe('checkStoredSecrets', () => {
  it('stops the start-up with a clear message when SECRET_KEY changed', async () => {
    const { db, close } = openDatabase(':memory:')
    try {
      await new SqliteInstanceConfigRepository(db, createSecretBox(KEY)).update({ app: FAKE_APP })
      const otherKey = new SqliteInstanceConfigRepository(db, createSecretBox(OTHER_KEY))
      await expect(checkStoredSecrets(otherKey)).rejects.toThrow(
        new StartupError(SECRET_KEY_MISMATCH),
      )
      const sameKey = new SqliteInstanceConfigRepository(db, createSecretBox(KEY))
      await expect(checkStoredSecrets(sameKey)).resolves.toBeUndefined()
    } finally {
      close()
    }
  })

  it('passes on a database without secrets yet', async () => {
    await expect(checkStoredSecrets(new InMemoryInstanceConfig())).resolves.toBeUndefined()
  })
})

describe('claimInstanceMode', () => {
  it('records the mode of the first start and refuses the other mode afterwards', async () => {
    const config = new InMemoryInstanceConfig()
    await claimInstanceMode(config, 'fake')
    expect(config.config.githubMode).toBe('fake')
    await claimInstanceMode(config, 'fake')
    await expect(claimInstanceMode(config, 'real')).rejects.toThrow(
      new StartupError(
        'This database was created with GITHUB_MODE=fake: it cannot be used with GITHUB_MODE=real. Point DATABASE_PATH to another database file.',
      ),
    )
    expect(config.config.githubMode).toBe('fake')
  })
})

describe('claimInstanceMode on an instance created before the mode was recorded', () => {
  it('claims it as real, and refuses the demo mode', async () => {
    const upgraded = new InMemoryInstanceConfig()
    upgraded.config = { ...upgraded.config, app: FAKE_APP }
    await expect(claimInstanceMode(upgraded, 'fake')).rejects.toThrow(
      new StartupError(
        'This database was created with GITHUB_MODE=real: it cannot be used with GITHUB_MODE=fake. Point DATABASE_PATH to another database file.',
      ),
    )
    expect(upgraded.config.githubMode).toBe('real')
    await claimInstanceMode(upgraded, 'real')
    expect(upgraded.config.githubMode).toBe('real')
  })
})

describe('checkAppGitHubOrigin', () => {
  const LOCAL = 'http://127.0.0.1:3402'
  const withApp = (htmlUrl: string) => {
    const config = new InMemoryInstanceConfig()
    config.config = { ...config.config, app: { ...FAKE_APP, htmlUrl } }
    return config
  }

  it('passes when the stored App belongs to the GitHub this server talks to, or there is none', async () => {
    await expect(
      checkAppGitHubOrigin(new InMemoryInstanceConfig(), undefined),
    ).resolves.toBeUndefined()
    await expect(checkAppGitHubOrigin(new InMemoryInstanceConfig(), LOCAL)).resolves.toBeUndefined()
    await expect(
      checkAppGitHubOrigin(withApp('https://github.com/apps/repoerd-test'), undefined),
    ).resolves.toBeUndefined()
    await expect(
      checkAppGitHubOrigin(withApp(`${LOCAL}/apps/repoerd-e2e`), LOCAL),
    ).resolves.toBeUndefined()
  })

  it('refuses a real App while the test GitHub is set', async () => {
    const start = checkAppGitHubOrigin(withApp('https://github.com/apps/repoerd-test'), LOCAL)
    await expect(start).rejects.toThrow(StartupError)
    await expect(start).rejects.toThrow(
      'REPOERD_TEST_GITHUB_URL is set (tests only), but the GitHub App of this database was registered on https://github.com',
    )
  })

  it('refuses an App of a test GitHub without it, or of another test GitHub', async () => {
    const start = checkAppGitHubOrigin(withApp(`${LOCAL}/apps/repoerd-e2e`), undefined)
    await expect(start).rejects.toThrow(StartupError)
    await expect(start).rejects.toThrow(
      'The GitHub App of this database was registered on http://127.0.0.1:3402, not on https://github.com',
    )
    await expect(
      checkAppGitHubOrigin(withApp(`${LOCAL}/apps/repoerd-e2e`), 'http://127.0.0.1:4000'),
    ).rejects.toThrow(StartupError)
    await expect(checkAppGitHubOrigin(withApp('not a URL'), undefined)).rejects.toThrow(
      StartupError,
    )
  })
})

describe('forgetAccessWithoutApp', () => {
  it('signs everybody out when the instance starts without GitHub App, and only then', async () => {
    const config = new InMemoryInstanceConfig()
    const users = new InMemoryUserRepository()
    const sessions = new InMemorySessionRepository()
    users.tokens.set('1', {
      accessToken: 'ghu_1',
      accessTokenExpiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
    })
    sessions.sessions.set('a', {
      idHash: 'a',
      userId: '1',
      expiresAt: new Date(10_000),
      lastSeenAt: new Date(0),
      createdAt: new Date(0),
    })
    config.config = { ...config.config, app: FAKE_APP }
    expect(await forgetAccessWithoutApp({ config, users, sessions })).toEqual({
      tokensCleared: 0,
      sessionsDeleted: 0,
    })
    expect(sessions.sessions.size).toBe(1)

    config.config = { ...config.config, app: null }
    expect(await forgetAccessWithoutApp({ config, users, sessions })).toEqual({
      tokensCleared: 1,
      sessionsDeleted: 1,
    })
    expect(users.tokens.size).toBe(0)
  })
})

describe('insecurePublicUrlWarning', () => {
  it('warns about plain HTTP outside localhost only', () => {
    expect(insecurePublicUrlWarning('http://erd.example.com')).toContain('uses plain HTTP')
    expect(insecurePublicUrlWarning('https://erd.example.com')).toBeNull()
    expect(insecurePublicUrlWarning('http://localhost:5173')).toBeNull()
    expect(insecurePublicUrlWarning(null)).toBeNull()
  })
})
