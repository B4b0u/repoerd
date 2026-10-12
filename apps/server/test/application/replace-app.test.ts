import { describe, expect, it } from 'vitest'
import type { GitHubAppCredentials } from '../../src/application/ports/instance-config.js'
import { makeReplaceApp } from '../../src/application/use-cases/replace-app.js'
import { FAKE_APP, FakeAppRegistrar } from '../fakes/fake-github.js'
import {
  InMemoryInstanceConfig,
  InMemorySessionRepository,
  InMemoryUserRepository,
} from '../fakes/in-memory-stores.js'

const ORG_APP: GitHubAppCredentials = {
  ...FAKE_APP,
  appId: 43,
  slug: 'repoerd-acme',
  name: 'RepoERD acme',
  htmlUrl: 'https://github.com/apps/repoerd-acme',
  ownerLogin: 'acme-org',
  ownerType: 'Organization',
  clientId: 'Iv1.other',
}
const TOKENS = {
  accessToken: 'ghu_1',
  accessTokenExpiresAt: null,
  refreshToken: null,
  refreshTokenExpiresAt: null,
}
const TIMES = { expiresAt: new Date('2099-01-01'), lastSeenAt: new Date(0), createdAt: new Date(0) }

function world() {
  const config = new InMemoryInstanceConfig()
  config.config = {
    ...config.config,
    publicUrl: 'https://erd.example.com',
    app: FAKE_APP,
    allowedOrgs: ['acme'],
    githubMode: 'real',
  }
  const users = new InMemoryUserRepository()
  users.users.set('admin', { id: 'admin', login: 'admin', avatarUrl: null, isAdmin: true })
  users.users.set('2', { id: '2', login: 'bob', avatarUrl: null, isAdmin: false })
  users.tokens.set('admin', TOKENS)
  users.tokens.set('2', TOKENS)
  const sessions = new InMemorySessionRepository()
  sessions.sessions.set('a', { idHash: 'a', userId: 'admin', ...TIMES })
  sessions.sessions.set('b', { idHash: 'b', userId: '2', ...TIMES })
  const registrar = new FakeAppRegistrar()
  registrar.convertManifest = async (code) => (code === 'manifest-code' ? ORG_APP : null)
  /** The App saved when the GitHub adapters were told to forget the previous one. */
  const forgotten: (GitHubAppCredentials | null)[] = []
  const replaceApp = makeReplaceApp({
    config,
    users,
    sessions,
    registrar,
    forgetGitHubState: () => {
      forgotten.push(config.config.app)
    },
  })
  return { config, users, sessions, registrar, forgotten, replaceApp }
}

describe('replacing the GitHub App', () => {
  it('builds a manifest from the saved public URL that brings GitHub back to the replacement callback', async () => {
    const { replaceApp } = world()
    const forOrg = await replaceApp.startManifest({ organization: 'acme-org', state: 'st' })
    expect(forOrg.ok && forOrg.value.postUrl).toBe(
      'https://github.com/organizations/acme-org/settings/apps/new?state=st',
    )
    expect(forOrg.ok && forOrg.value.manifest).toMatchObject({
      url: 'https://erd.example.com',
      redirect_url: 'https://erd.example.com/setup/github/replace-callback',
      public: false,
    })
    const personal = await replaceApp.startManifest({ state: 'st' })
    expect(personal.ok && personal.value.postUrl).toBe(
      'https://github.com/settings/apps/new?state=st',
    )
  })

  it('refuses an invalid organisation, and an instance without public URL', async () => {
    const { replaceApp, config } = world()
    expect(await replaceApp.startManifest({ organization: 'not an org', state: 'st' })).toEqual({
      ok: false,
      error: { kind: 'invalid-organization', login: 'not an org' },
    })
    config.config = { ...config.config, publicUrl: null }
    expect(await replaceApp.startManifest({ state: 'st' })).toEqual({
      ok: false,
      error: { kind: 'not-configured' },
    })
  })

  it('saves the App created on GitHub, then signs everybody out and keeps the rest', async () => {
    const { replaceApp, config, users, sessions, forgotten } = world()
    expect(await replaceApp.completeManifest('manifest-code')).toEqual({
      ok: true,
      value: undefined,
    })
    expect(config.config).toEqual({
      publicUrl: 'https://erd.example.com',
      app: ORG_APP,
      allowedOrgs: ['acme'],
      setupCodeHash: null,
      setupGrant: null,
      githubMode: 'real',
    })
    expect(config.config.app?.ownerType).toBe('Organization')
    // The adapters forgot the old App once the new one was saved: what they load next is the new one's.
    expect(forgotten).toEqual([ORG_APP])
    expect(users.tokens.size).toBe(0)
    expect(sessions.sessions.size).toBe(0)
    expect(await users.listAdmins()).toEqual([
      { id: 'admin', login: 'admin', avatarUrl: null, isAdmin: true },
    ])
  })

  it('saves new credentials of the same App once GitHub confirmed them', async () => {
    const { replaceApp, config, sessions } = world()
    const rotated = {
      appId: 42,
      clientId: 'Iv1.client',
      clientSecret: 'rotated',
      privateKey: 'new-pem',
    }
    expect(await replaceApp.saveExistingApp(rotated)).toEqual({ ok: true, value: undefined })
    expect(config.config.app).toEqual({
      ...FAKE_APP,
      clientSecret: 'rotated',
      privateKey: 'new-pem',
    })
    expect(sessions.sessions.size).toBe(0)
  })

  it('changes nothing when GitHub refuses the code or the credentials', async () => {
    const { replaceApp, config, users, sessions, forgotten } = world()
    expect(await replaceApp.completeManifest('expired')).toEqual({
      ok: false,
      error: { kind: 'github-rejected' },
    })
    expect(
      await replaceApp.saveExistingApp({
        appId: 7,
        clientId: 'Iv1.client',
        clientSecret: 's',
        privateKey: 'k',
      }),
    ).toEqual({ ok: false, error: { kind: 'github-rejected' } })
    expect(config.config.app).toEqual(FAKE_APP)
    expect(users.tokens.size).toBe(2)
    expect(sessions.sessions.size).toBe(2)
    expect(forgotten).toEqual([])
  })
})
