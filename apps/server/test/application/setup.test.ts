import { describe, expect, it } from 'vitest'
import { makeSetup } from '../../src/application/use-cases/setup.js'
import { FAKE_APP, FakeAppRegistrar } from '../fakes/fake-github.js'
import { FakeTokenService } from '../fakes/fake-tokens.js'
import { InMemoryInstanceConfig, InMemoryUserRepository } from '../fakes/in-memory-stores.js'

const NOW = new Date('2026-10-10T12:00:00Z')
const HOUR = 3600_000

function world() {
  const config = new InMemoryInstanceConfig()
  const users = new InMemoryUserRepository()
  const registrar = new FakeAppRegistrar()
  const tokens = new FakeTokenService()
  let clock = NOW
  const setup = makeSetup({
    config,
    users,
    tokens,
    registrar,
    now: () => clock,
  })
  const unlock = async () => {
    await setup.issueCode()
    const unlocked = await setup.unlock('ABCD-EFGH-JKMN')
    if (!unlocked.ok) throw new Error('unlock failed')
    return unlocked.value.grant
  }
  const addAdmin = async () => {
    await users.upsert({ id: '1', login: 'alice', avatarUrl: null })
    await users.setAdmin('1', true)
  }
  return {
    config,
    users,
    registrar,
    tokens,
    setup,
    unlock,
    addAdmin,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms)
    },
  }
}

describe('setup', () => {
  it('issues a one-time code while no administrator exists', async () => {
    const { setup, config, addAdmin } = world()
    expect(await setup.issueCode()).toBe('ABCD-EFGH-JKMN')
    expect(config.config.setupCodeHash).toBe('hash(ABCDEFGHJKMN)')

    config.config = { ...config.config, app: FAKE_APP }
    await addAdmin()
    expect(await setup.issueCode()).toBeNull()
    expect(config.config.setupCodeHash).toBeNull()
  })

  it('unlocks with the code (any case, spaces or dashes) for one hour', async () => {
    const { setup, advance } = world()
    await setup.issueCode()
    expect(await setup.unlock('WRONG-CODE-0000')).toEqual({
      ok: false,
      error: { kind: 'invalid-code' },
    })

    const unlocked = await setup.unlock('abcd efgh jkmn')
    expect(unlocked).toEqual({
      ok: true,
      value: { grant: 'token-1', expiresAt: new Date(NOW.getTime() + HOUR) },
    })
    expect(await setup.status('token-1')).toMatchObject({ state: 'needs-app', unlocked: true })
    expect(await setup.status('forged')).toMatchObject({ unlocked: false })
    expect(await setup.status()).toMatchObject({ unlocked: false })

    advance(HOUR)
    expect(await setup.status('token-1')).toMatchObject({ unlocked: false })
  })

  it('keeps the same code whatever the number of wrong attempts', async () => {
    const { setup, config, tokens, advance } = world()
    await setup.issueCode()
    const stored = config.config.setupCodeHash
    tokens.code = 'NEWC-ODE0-0001'
    for (let attempt = 1; attempt <= 100; attempt++) {
      await setup.unlock('WRONG-CODE-0000')
      advance(2_000)
    }
    expect(config.config.setupCodeHash).toBe(stored)
    expect(await setup.unlock('ABCD-EFGH-JKMN')).toMatchObject({ ok: true })
  })

  it('slows down wrong codes past 30 a minute, but always accepts the right one', async () => {
    const { setup, advance } = world()
    await setup.issueCode()
    for (let attempt = 1; attempt <= 30; attempt++) {
      expect(await setup.unlock('WRONG-CODE-0000')).toEqual({
        ok: false,
        error: { kind: 'invalid-code' },
      })
    }
    expect(await setup.unlock('WRONG-CODE-0000')).toEqual({
      ok: false,
      error: { kind: 'too-many-attempts', retryAfterSeconds: 2 },
    })
    expect(await setup.unlock('ABCD-EFGH-JKMN')).toMatchObject({ ok: true })
    advance(2_000)
    expect(await setup.unlock('WRONG-CODE-0000')).toEqual({
      ok: false,
      error: { kind: 'invalid-code' },
    })
  })

  it('refuses to unlock when no code was issued', async () => {
    const { setup } = world()
    expect(await setup.unlock('ABCD-EFGH-JKMN')).toEqual({
      ok: false,
      error: { kind: 'invalid-code' },
    })
  })

  it('builds the manifest for a personal account or an organisation and saves the public URL', async () => {
    const { setup, unlock, config } = world()
    const grant = await unlock()

    const personal = await setup.startManifest({
      grant,
      publicUrl: 'https://erd.example.com/',
      state: 'st',
    })
    expect(personal.ok && personal.value.postUrl).toBe(
      'https://github.com/settings/apps/new?state=st',
    )
    expect(personal.ok && personal.value.manifest).toMatchObject({
      url: 'https://erd.example.com',
      redirect_url: 'https://erd.example.com/setup/github/callback',
      callback_urls: ['https://erd.example.com/auth/callback'],
      default_permissions: { contents: 'read', metadata: 'read' },
    })
    // No webhook at all: GitHub rejects a localhost hook URL even when the hook is inactive.
    expect(personal.ok && 'hook_attributes' in personal.value.manifest).toBe(false)
    expect(config.config.publicUrl).toBe('https://erd.example.com')

    const org = await setup.startManifest({
      grant,
      publicUrl: 'https://erd.example.com',
      organization: 'acme-corp',
      state: 'st',
    })
    expect(org.ok && org.value.postUrl).toBe(
      'https://github.com/organizations/acme-corp/settings/apps/new?state=st',
    )
  })

  it('validates the grant, the public URL and the organisation', async () => {
    const { setup, unlock, config } = world()
    const grant = await unlock()
    const start = (input: { grant?: string; publicUrl?: string; organization?: string }) =>
      setup.startManifest({ publicUrl: 'https://erd.example.com', state: 'st', ...input })

    expect(await start({ grant: 'forged' })).toEqual({
      ok: false,
      error: { kind: 'invalid-grant' },
    })
    expect(config.config.publicUrl).toBeNull()
    expect(await start({ grant, publicUrl: 'ftp://erd.example.com' })).toEqual({
      ok: false,
      error: { kind: 'invalid-public-url' },
    })
    expect(await start({ grant, organization: 'acme corp' })).toEqual({
      ok: false,
      error: { kind: 'invalid-organization', login: 'acme corp' },
    })
  })

  it('saves the App created by the manifest flow', async () => {
    const { setup, unlock, config } = world()
    const grant = await unlock()
    expect(await setup.completeManifest({ grant, code: 'manifest-code' })).toEqual({
      ok: false,
      error: { kind: 'invalid-public-url' },
    })

    await setup.startManifest({ grant, publicUrl: 'https://erd.example.com', state: 'st' })
    expect(await setup.completeManifest({ grant, code: 'reused-code' })).toEqual({
      ok: false,
      error: { kind: 'github-rejected' },
    })
    expect(await setup.completeManifest({ code: 'manifest-code' })).toEqual({
      ok: false,
      error: { kind: 'invalid-grant' },
    })
    expect(config.config.app).toBeNull()

    expect(await setup.completeManifest({ grant, code: 'manifest-code' })).toEqual({
      ok: true,
      value: undefined,
    })
    expect(config.config.app).toEqual(FAKE_APP)
    expect(await setup.status(grant)).toEqual({
      state: 'needs-admin',
      unlocked: true,
      publicUrl: 'https://erd.example.com',
      app: {
        name: 'RepoERD test',
        htmlUrl: 'https://github.com/apps/repoerd-test',
        installUrl: 'https://github.com/apps/repoerd-test/installations/new',
      },
    })
  })

  it('saves an existing App once GitHub confirmed its credentials', async () => {
    const { setup, unlock, config } = world()
    const grant = await unlock()
    const input = {
      grant,
      publicUrl: 'https://erd.example.com',
      appId: 42,
      clientId: 'Iv1.client',
      clientSecret: 's',
      privateKey: 'k',
    }

    for (const grant of [undefined, 'forged']) {
      expect(await setup.saveExistingApp({ ...input, grant })).toEqual({
        ok: false,
        error: { kind: 'invalid-grant' },
      })
    }
    expect(config.config).toMatchObject({ app: null, publicUrl: null })
    expect(await setup.saveExistingApp({ ...input, clientId: 'Iv1.other' })).toEqual({
      ok: false,
      error: { kind: 'github-rejected' },
    })
    expect(await setup.saveExistingApp(input)).toEqual({ ok: true, value: undefined })
    expect(config.config).toMatchObject({
      publicUrl: 'https://erd.example.com',
      app: { ...FAKE_APP, clientSecret: 's', privateKey: 'k' },
    })
  })

  it('is ready as soon as an App is saved when administrators remain (after reset-app), and spends the code', async () => {
    const { setup, config, unlock, addAdmin } = world()
    await addAdmin()
    const grant = await unlock()
    expect(
      await setup.saveExistingApp({
        grant,
        publicUrl: 'https://erd.example.com',
        appId: 42,
        clientId: 'Iv1.client',
        clientSecret: 's',
        privateKey: 'k',
      }),
    ).toEqual({ ok: true, value: undefined })
    expect((await setup.status(grant)).state).toBe('ready')
    expect(config.config).toMatchObject({ setupCodeHash: null, setupGrant: null })
  })

  it('refuses every change once an administrator exists', async () => {
    const { setup, unlock, config, addAdmin } = world()
    const grant = await unlock()
    config.config = { ...config.config, app: FAKE_APP }
    await addAdmin()
    const configured = { ok: false, error: { kind: 'already-configured' } }

    expect(await setup.unlock('ABCD-EFGH-JKMN')).toEqual(configured)
    expect(
      await setup.startManifest({ grant, publicUrl: 'https://erd.example.com', state: 'st' }),
    ).toEqual(configured)
    expect(await setup.completeManifest({ grant, code: 'manifest-code' })).toEqual(configured)
    expect(
      await setup.saveExistingApp({
        grant,
        publicUrl: 'https://erd.example.com',
        appId: 42,
        clientId: 'Iv1.client',
        clientSecret: 's',
        privateKey: 'k',
      }),
    ).toEqual(configured)
    expect(config.config).toMatchObject({ app: FAKE_APP, publicUrl: null })
    expect(await setup.status(grant)).toMatchObject({ state: 'ready', unlocked: false })
  })

  it('does not replace the App when the instance became ready while GitHub answered', async () => {
    const configured = { ok: false, error: { kind: 'already-configured' } }
    const other = { ...FAKE_APP, appId: 99, slug: 'other' }
    /** An instance waiting for its administrator, who signs in while GitHub answers. */
    async function racing() {
      const { setup, unlock, config, registrar, addAdmin } = world()
      const grant = await unlock()
      config.config = { ...config.config, publicUrl: 'https://erd.example.com', app: FAKE_APP }
      const slowGitHub = async () => {
        await addAdmin()
        return other
      }
      registrar.convertManifest = slowGitHub
      registrar.verify = slowGitHub
      return { setup, config, grant }
    }

    const manifest = await racing()
    expect(
      await manifest.setup.completeManifest({ grant: manifest.grant, code: 'manifest-code' }),
    ).toEqual(configured)
    expect(manifest.config.config.app).toEqual(FAKE_APP)

    const existing = await racing()
    expect(
      await existing.setup.saveExistingApp({
        grant: existing.grant,
        publicUrl: 'https://other.example.com',
        appId: 99,
        clientId: 'Iv1.other',
        clientSecret: 's',
        privateKey: 'k',
      }),
    ).toEqual(configured)
    expect(existing.config.config).toMatchObject({
      app: FAKE_APP,
      publicUrl: 'https://erd.example.com',
    })
  })
})
