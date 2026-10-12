import { apiPaths, type SchemaResponse } from '@repoerd/contracts'
import { describe, expect, it } from 'vitest'
import { testRepoId } from '../fakes/in-memory-git-host.js'
import { accessible } from '../fakes/in-memory-repo-directory.js'
import { buildRealModeApp, jsonRequest } from './build-app.js'

const shop = { owner: 'acme', name: 'shop' }
const core = { name: 'core', format: 'prisma', paths: ['prisma/schema.prisma'] }

describe('repository settings routes', () => {
  it('read the settings and tell whether the user may change them', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn()
    const response = await world.app.request(apiPaths.repoSettings(shop), { headers: { cookie } })
    expect(await response.json()).toEqual({ sources: [], canEdit: true })
  })

  it('save normalised sources, which the schema then uses', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn()
    const saved = await world.app.request(
      apiPaths.repoSettings(shop),
      jsonRequest('PUT', { sources: [{ ...core, name: ' core ' }] }, cookie),
    )
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ sources: [core], canEdit: true })

    const schema = (await (
      await world.app.request(apiPaths.schema(shop), { headers: { cookie } })
    ).json()) as SchemaResponse
    expect(schema.selectedSourceId).toBe('manual:core')
    expect(Object.keys(schema.schema?.tables ?? {})).toEqual(['users'])
  })

  it('explain why sources are refused', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn()
    const refused = await world.app.request(
      apiPaths.repoSettings(shop),
      jsonRequest('PUT', { sources: [{ ...core, paths: ['../outside'] }] }, cookie),
    )
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({
      error: {
        code: 'bad_request',
        message:
          'Path "../outside" of source "core" must be relative to the repository root, without "..", "\\" or control characters',
        details: { reason: 'path-invalid', name: 'core', path: '../outside' },
      },
    })
    expect(
      (
        await world.app.request(
          apiPaths.repoSettings(shop),
          jsonRequest('PUT', { sources: 'x' }, cookie),
        )
      ).status,
    ).toBe(400)
  })

  it('are read-only without push access', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn()
    world.directory.snapshot = { accounts: ['acme'], repos: [accessible('acme', 'shop', false)] }
    expect(
      await (await world.app.request(apiPaths.repoSettings(shop), { headers: { cookie } })).json(),
    ).toEqual({
      sources: [],
      canEdit: false,
    })
    const write = await world.app.request(
      apiPaths.repoSettings(shop),
      jsonRequest('PUT', { sources: [core] }, cookie),
    )
    expect(write.status).toBe(403)
    // Authorisation comes before the body: an invalid body is refused the same way.
    const invalid = await world.app.request(
      apiPaths.repoSettings(shop),
      jsonRequest('PUT', { sources: 'x' }, cookie),
    )
    expect(invalid.status).toBe(403)
    expect(await world.settings.get({ ...shop, id: testRepoId('acme', 'shop') })).toEqual([])
  })

  it('answer the same 404 for invisible and nonexistent repositories', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn()
    const notFound = await (
      await world.app.request('/api/repos/acme/nope/schema', { headers: { cookie } })
    ).json()
    const secret = { owner: 'acme', name: 'secret' }
    const read = await world.app.request(apiPaths.repoSettings(secret), { headers: { cookie } })
    const write = await world.app.request(
      apiPaths.repoSettings(secret),
      jsonRequest('PUT', { sources: [core] }, cookie),
    )
    expect(read.status).toBe(404)
    expect(await read.json()).toEqual(notFound)
    expect(write.status).toBe(404)
    expect(await write.json()).toEqual(notFound)
    const invalid = await world.app.request(
      apiPaths.repoSettings(secret),
      jsonRequest('PUT', { sources: 'x' }, cookie),
    )
    expect(invalid.status).toBe(404)
    expect(await invalid.json()).toEqual(notFound)
    const withoutHeader = await world.app.request(apiPaths.repoSettings(shop), {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ sources: [] }),
    })
    expect(withoutHeader.status).toBe(403)
  })
})
