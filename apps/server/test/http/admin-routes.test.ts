import {
  type AdminListResponse,
  type AdminUsersResponse,
  apiPaths,
  MUTATION_HEADER,
} from '@repoerd/contracts'
import { describe, expect, it } from 'vitest'
import { buildFakeModeApp, buildRealModeApp, cookiesFrom, jsonRequest } from './build-app.js'

const remove = (cookie: string) => ({
  method: 'DELETE',
  headers: { cookie, [MUTATION_HEADER]: '1' },
})

describe('administration routes', () => {
  it('are reserved to administrators', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn()
    for (const response of [
      await world.app.request(apiPaths.adminConfig, { headers: { cookie } }),
      await world.app.request(apiPaths.adminAdmins, { headers: { cookie } }),
      await world.app.request(
        apiPaths.adminConfig,
        jsonRequest('PUT', { allowedOrgs: [] }, cookie),
      ),
      await world.app.request(apiPaths.adminAdmin('admin'), remove(cookie)),
      await world.app.request(apiPaths.adminAdmins, jsonRequest('POST', { login: 'me' }, cookie)),
      await world.app.request('/api/admin/whatever', { headers: { cookie } }),
      await world.app.request(apiPaths.adminAppManifest, jsonRequest('POST', {}, cookie)),
      await world.app.request(apiPaths.adminExistingApp, jsonRequest('POST', {}, cookie)),
      await world.app.request(apiPaths.adminUsers, { headers: { cookie } }),
      await world.app.request(apiPaths.adminUserSessions('admin'), remove(cookie)),
    ]) {
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        error: {
          code: 'forbidden',
          message: 'Administrators only',
          details: { reason: 'admins-only' },
        },
      })
    }
  })

  it('require a GitHub access that still works, in an allowed organisation', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn('admin', 'admin')
    world.directory.byUser.set('admin', null)
    const revoked = await world.app.request(apiPaths.adminConfig, { headers: { cookie } })
    expect(revoked.status).toBe(401)
    expect(await revoked.json()).toMatchObject({ error: { code: 'reauth_required' } })

    world.directory.byUser.set('admin', { accounts: ['elsewhere'], repos: [] })
    world.config.config = { ...world.config.config, allowedOrgs: ['acme'] }
    const outside = await world.app.request(
      apiPaths.adminConfig,
      jsonRequest('PUT', { allowedOrgs: [] }, cookie),
    )
    expect(outside.status).toBe(403)
    expect(await outside.json()).toMatchObject({ error: { code: 'org_not_allowed' } })
    expect(world.config.config.allowedOrgs).toEqual(['acme'])
  })

  it('decide on a fresh organisation list, not on a cached one', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn('admin', 'admin')
    world.config.config = { ...world.config.config, allowedOrgs: ['acme'] }
    world.directory.staleByUser.set('admin', { accounts: ['acme'], repos: [] })
    world.directory.byUser.set('admin', { accounts: ['elsewhere'], repos: [] })

    const response = await world.app.request(
      apiPaths.adminConfig,
      jsonRequest('PUT', { allowedOrgs: [] }, cookie),
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'org_not_allowed' } })
    expect(world.config.config.allowedOrgs).toEqual(['acme'])
  })

  it('list the users with their activity and end the sessions of one of them', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn('admin', 'admin')
    await world.signIn('2', 'bob')
    await world.users.upsert({ id: '3', login: 'bob', avatarUrl: null })
    await world.users.recordActivity('admin', new Date('2026-10-09T08:00:00Z'))

    const listed = await world.app.request(apiPaths.adminUsers, { headers: { cookie } })
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual({
      users: [
        {
          id: 'admin',
          login: 'admin',
          stale: false,
          avatarUrl: null,
          isAdmin: true,
          lastSeenAt: '2026-10-09T08:00:00.000Z',
          activeSessions: 1,
        },
        {
          id: '3',
          login: 'bob',
          stale: false,
          avatarUrl: null,
          isAdmin: false,
          lastSeenAt: null,
          activeSessions: 0,
        },
        {
          id: '2',
          login: 'bob',
          stale: true,
          avatarUrl: null,
          isAdmin: false,
          lastSeenAt: null,
          activeSessions: 1,
        },
      ],
    } satisfies AdminUsersResponse)

    const signedOut = await world.app.request(apiPaths.adminUserSessions('2'), remove(cookie))
    expect(signedOut.status).toBe(200)
    const after = (await signedOut.json()) as AdminUsersResponse
    expect(after.users.find((user) => user.id === '2')?.activeSessions).toBe(0)
    expect(cookiesFrom(signedOut)).toEqual({})
    const bob = await world.app.request(apiPaths.me, {
      headers: { cookie: 'repoerd_session=session-2' },
    })
    expect(bob.status).toBe(401)

    const unknown = await world.app.request(apiPaths.adminUserSessions('nobody'), remove(cookie))
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toMatchObject({
      error: { code: 'not_found', details: { reason: 'user-never-signed-in' } },
    })
  })

  it('clear the cookie of an administrator who signs themselves out everywhere', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn('admin', 'admin')
    const response = await world.app.request(apiPaths.adminUserSessions('admin'), remove(cookie))
    expect(response.status).toBe(200)
    expect(cookiesFrom(response)).toEqual({ repoerd_session: '' })
    expect((await world.app.request(apiPaths.adminUsers, { headers: { cookie } })).status).toBe(401)
  })

  it('list the demo user in fake mode', async () => {
    const { app } = buildFakeModeApp()
    expect(await (await app.request(apiPaths.adminUsers)).json()).toEqual({
      users: [
        {
          id: 'fake-user',
          login: 'dev',
          stale: false,
          avatarUrl: null,
          isAdmin: true,
          lastSeenAt: null,
          activeSessions: 0,
        },
      ],
    })
  })

  it('show the App and save the organisations and the public URL', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn('admin', 'admin')
    expect(
      await (await world.app.request(apiPaths.adminConfig, { headers: { cookie } })).json(),
    ).toMatchObject({
      mode: 'real',
      publicUrl: 'https://erd.example.com',
      callbackUrl: 'https://erd.example.com/auth/callback',
      allowedOrgs: [],
      app: { settingsUrl: 'https://github.com/settings/apps/repoerd-test' },
    })

    const saved = await world.app.request(
      apiPaths.adminConfig,
      jsonRequest('PUT', { allowedOrgs: ['Acme'], publicUrl: 'https://new.example.com/' }, cookie),
    )
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({
      allowedOrgs: ['acme'],
      publicUrl: 'https://new.example.com',
    })

    const lockout = await world.app.request(
      apiPaths.adminConfig,
      jsonRequest('PUT', { allowedOrgs: ['other'] }, cookie),
    )
    expect(lockout.status).toBe(409)
    expect(await lockout.json()).toMatchObject({
      error: { code: 'conflict', details: { reason: 'self-lockout' } },
    })
    const invalid = await world.app.request(
      apiPaths.adminConfig,
      jsonRequest('PUT', { allowedOrgs: ['bad org'] }, cookie),
    )
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({
      error: { details: { reason: 'invalid-organization', login: 'bad org' } },
    })
  })

  it('add and remove administrators, never the last one', async () => {
    const world = buildRealModeApp()
    await world.signIn('1', 'alice')
    const cookie = await world.signIn('admin', 'admin')

    const added = await world.app.request(
      apiPaths.adminAdmins,
      jsonRequest('POST', { login: 'ALICE' }, cookie),
    )
    expect(((await added.json()) as AdminListResponse).admins.map((admin) => admin.login)).toEqual([
      'admin',
      'alice',
    ])
    const unknown = await world.app.request(
      apiPaths.adminAdmins,
      jsonRequest('POST', { login: 'nobody' }, cookie),
    )
    expect(unknown.status).toBe(404)

    const removed = await world.app.request(apiPaths.adminAdmin('1'), remove(cookie))
    expect(((await removed.json()) as AdminListResponse).admins.map((admin) => admin.id)).toEqual([
      'admin',
    ])
    const last = await world.app.request(apiPaths.adminAdmin('admin'), remove(cookie))
    expect(last.status).toBe(409)
    expect(await last.json()).toMatchObject({ error: { details: { reason: 'last-admin' } } })

    const notAdmin = await world.app.request(apiPaths.adminAdmin('1'), remove(cookie))
    expect(notAdmin.status).toBe(404)
    expect(await notAdmin.json()).toEqual({
      error: {
        code: 'not_found',
        message: 'This user is not an administrator',
        details: { reason: 'not-admin' },
      },
    })
    const neverSignedIn = await world.app.request(apiPaths.adminAdmin('ghost'), remove(cookie))
    expect(neverSignedIn.status).toBe(404)
    expect(await neverSignedIn.json()).toEqual({
      error: {
        code: 'not_found',
        message: 'This GitHub user has never signed in to RepoERD',
        details: { reason: 'user-never-signed-in' },
      },
    })
  })

  it('work in fake mode, without App', async () => {
    const { app } = buildFakeModeApp()
    expect(await (await app.request(apiPaths.adminConfig)).json()).toEqual({
      mode: 'fake',
      version: expect.any(String),
      publicUrl: null,
      callbackUrl: null,
      allowedOrgs: [],
      app: null,
    })
    expect(
      ((await (await app.request(apiPaths.adminAdmins)).json()) as AdminListResponse).admins,
    ).toEqual([{ id: 'fake-user', login: 'dev', avatarUrl: null }])
  })

  it('refuse a configuration saved from an older copy of the page', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn('admin', 'admin')
    const read = async () =>
      (await (await world.app.request(apiPaths.adminConfig, { headers: { cookie } })).json()) as {
        version: string
      }
    const { version } = await read()
    const first = await world.app.request(
      apiPaths.adminConfig,
      jsonRequest('PUT', { allowedOrgs: ['acme'], version }, cookie),
    )
    expect(first.status).toBe(200)
    expect((await read()).version).not.toBe(version)
    const stale = await world.app.request(
      apiPaths.adminConfig,
      jsonRequest('PUT', { allowedOrgs: [], version }, cookie),
    )
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({
      error: { code: 'conflict', details: { reason: 'config-changed' } },
    })
  })
})
