import { apiPaths, MUTATION_HEADER, type TableGroupsResponse } from '@repoerd/contracts'
import type { TableGroup } from '@repoerd/model'
import { describe, expect, it } from 'vitest'
import { createRateLimiter } from '../../src/domain/rate-limit.js'
import { testRepoId } from '../fakes/in-memory-git-host.js'
import { accessible } from '../fakes/in-memory-repo-directory.js'
import { buildFakeModeApp, buildRealModeApp, jsonRequest } from './build-app.js'

const shop = { owner: 'acme', name: 'shop' }
const source = 'prisma/schema.prisma'
const repoKey = { ...shop, id: testRepoId('acme', 'shop') }
const billing: TableGroup = { id: 'billing', name: 'Billing', color: '#aabbcc', origins: [] }
const auth: TableGroup = {
  id: 'auth',
  name: 'Auth',
  color: '#112233',
  origins: [{ kind: 'folder', path: 'src/auth' }],
}
const { id: _billingId, ...billingBody } = billing
const { id: _authId, ...authBody } = auth

const del = (cookie: string): RequestInit => ({
  method: 'DELETE',
  headers: { cookie, [MUTATION_HEADER]: '1' },
})

async function json(response: Response) {
  return (await response.json()) as TableGroupsResponse
}

describe('table group routes', () => {
  it('read "never configured" with the right to edit', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn()
    const response = await world.app.request(apiPaths.groups(shop, source), {
      headers: { cookie },
    })
    expect(await response.json()).toEqual({
      configured: false,
      groups: [],
      assignments: {},
      canEdit: true,
    })
    world.directory.snapshot = { accounts: ['acme'], repos: [accessible('acme', 'shop', false)] }
    const readOnly = await world.app.request(apiPaths.groups(shop, source), {
      headers: { cookie },
    })
    expect((await json(readOnly)).canEdit).toBe(false)
  })

  it('replace everything and read it back, normalised', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn()
    const put = await world.app.request(
      apiPaths.groups(shop, source),
      jsonRequest(
        'PUT',
        {
          groups: [{ ...billing, name: ' Billing ', color: '#AABBCC' }],
          assignments: { users: 'billing', posts: null },
        },
        cookie,
      ),
    )
    expect(put.status).toBe(200)
    const expected = {
      configured: true,
      groups: [billing],
      assignments: { users: 'billing', posts: null },
      canEdit: true,
    }
    expect(await put.json()).toEqual(expected)
    const read = await world.app.request(apiPaths.groups(shop, source), { headers: { cookie } })
    expect(await read.json()).toEqual(expected)
    // Replacing with an empty config is "configured, empty", not "never configured".
    await world.app.request(
      apiPaths.groups(shop, source),
      jsonRequest('PUT', { groups: [], assignments: {} }, cookie),
    )
    const empty = await world.app.request(apiPaths.groups(shop, source), { headers: { cookie } })
    expect(await json(empty)).toMatchObject({ configured: true, groups: [] })
  })

  it('refuse a replacement with a placement to a group absent from the body', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn()
    const refused = await world.app.request(
      apiPaths.groups(shop, source),
      jsonRequest('PUT', { groups: [billing], assignments: { users: 'ghost' } }, cookie),
    )
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({
      error: { code: 'bad_request', details: { reason: 'invalid-groups' } },
    })
    expect(world.tableGroups.stored.size).toBe(0)
  })

  it('refuse content (invalid-groups) and malformed bodies (invalid-body)', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn()
    const reasonOf = async (body: unknown) => {
      const response = await world.app.request(
        apiPaths.groups(shop, source),
        jsonRequest('PUT', body, cookie),
      )
      expect(response.status).toBe(400)
      return ((await response.json()) as { error: { details: { reason: string } } }).error.details
        .reason
    }
    expect(await reasonOf({ groups: [{ ...billing, color: 'red' }], assignments: {} })).toBe(
      'invalid-groups',
    )
    expect(await reasonOf({ groups: [billing, billing], assignments: {} })).toBe('invalid-groups')
    expect(await reasonOf({ groups: 'x' })).toBe('invalid-body')
  })

  it('keep both groups when two different ones are upserted one after the other', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn()
    for (const [id, body] of [
      ['billing', billingBody],
      ['auth', authBody],
    ] as const) {
      const response = await world.app.request(
        apiPaths.group(shop, source, id),
        jsonRequest('PUT', body, cookie),
      )
      expect(response.status).toBe(204)
    }
    const read = await world.app.request(apiPaths.groups(shop, source), { headers: { cookie } })
    expect((await json(read)).groups).toEqual([billing, auth])
  })

  it('refuse a group id outside the pattern and an invalid group body', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn()
    const badId = await world.app.request(
      `/api/repos/acme/shop/groups/a%20b?source=${encodeURIComponent(source)}`,
      jsonRequest('PUT', billingBody, cookie),
    )
    expect(badId.status).toBe(400)
    expect(await badId.json()).toMatchObject({ error: { details: { reason: 'invalid-groups' } } })
    const badBody = await world.app.request(
      apiPaths.group(shop, source, 'billing'),
      jsonRequest('PUT', { ...billingBody, name: '' }, cookie),
    )
    expect(badBody.status).toBe(400)
    expect(await badBody.json()).toMatchObject({ error: { details: { reason: 'invalid-groups' } } })
  })

  it('delete a group and its placements, also when it is absent', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn()
    await world.app.request(
      apiPaths.groups(shop, source),
      jsonRequest('PUT', { groups: [billing, auth], assignments: { users: 'billing' } }, cookie),
    )
    const deleted = await world.app.request(apiPaths.group(shop, source, 'billing'), del(cookie))
    expect(deleted.status).toBe(204)
    const again = await world.app.request(apiPaths.group(shop, source, 'billing'), del(cookie))
    expect(again.status).toBe(204)
    const read = await json(
      await world.app.request(apiPaths.groups(shop, source), { headers: { cookie } }),
    )
    expect(read.groups).toEqual([auth])
    expect(read.assignments).toEqual({})
  })

  it('place tables, and refuse a group deleted meanwhile without changing anything', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn()
    await world.app.request(
      apiPaths.groups(shop, source),
      jsonRequest('PUT', { groups: [billing, auth], assignments: { users: 'billing' } }, cookie),
    )
    const placed = await world.app.request(
      apiPaths.groupAssignments(shop, source),
      jsonRequest('PATCH', { assignments: { posts: 'auth', users: null } }, cookie),
    )
    expect(placed.status).toBe(204)
    await world.app.request(apiPaths.group(shop, source, 'auth'), del(cookie))
    const refused = await world.app.request(
      apiPaths.groupAssignments(shop, source),
      jsonRequest('PATCH', { assignments: { orders: 'billing', comments: 'auth' } }, cookie),
    )
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ error: { details: { reason: 'invalid-groups' } } })
    expect((await world.tableGroups.get(repoKey, source)).config.assignments).toEqual({
      users: null,
    })
  })

  it('answer invalid-groups-target without a source', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn()
    const base = '/api/repos/acme/shop'
    const calls: [string, RequestInit][] = [
      [`${base}/groups`, { headers: { cookie } }],
      [`${base}/groups`, jsonRequest('PUT', { groups: [], assignments: {} }, cookie)],
      [`${base}/groups/billing`, jsonRequest('PUT', billingBody, cookie)],
      [`${base}/groups/billing`, del(cookie)],
      [`${base}/groups-assignments`, jsonRequest('PATCH', { assignments: {} }, cookie)],
    ]
    for (const [path, init] of calls) {
      const response = await world.app.request(path, init)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        error: { details: { reason: 'invalid-groups-target' } },
      })
    }
  })

  it('refuse a 101st group and a PATCH past 5,000 placements, writing nothing', async () => {
    const world = buildRealModeApp({
      userRateLimit: createRateLimiter({ limit: 10_000, windowMs: 60_000 }),
    })
    const cookie = await world.signIn()
    for (let i = 0; i < 100; i++) {
      await world.app.request(
        apiPaths.group(shop, source, `g${i}`),
        jsonRequest('PUT', billingBody, cookie),
      )
    }
    const extra = await world.app.request(
      apiPaths.group(shop, source, 'extra'),
      jsonRequest('PUT', billingBody, cookie),
    )
    expect(extra.status).toBe(400)
    expect(await extra.json()).toMatchObject({ error: { details: { reason: 'invalid-groups' } } })
    expect((await world.tableGroups.get(repoKey, source)).config.groups).toHaveLength(100)

    const place = (assignments: Record<string, string>) =>
      world.app.request(
        apiPaths.groupAssignments(shop, source),
        jsonRequest('PATCH', { assignments }, cookie),
      )
    const tables = (from: number, to: number) =>
      Object.fromEntries(Array.from({ length: to - from }, (_, i) => [`t${from + i}`, 'g0']))
    expect((await place(tables(0, 5000))).status).toBe(204)
    const over = await place({ extra: 'g0' })
    expect(over.status).toBe(400)
    expect(await over.json()).toMatchObject({ error: { details: { reason: 'invalid-groups' } } })
    expect(
      Object.keys((await world.tableGroups.get(repoKey, source)).config.assignments),
    ).toHaveLength(5000)
  })

  it('answer invalid-groups-target for a source of 513 characters', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn()
    const response = await world.app.request(apiPaths.groups(shop, 's'.repeat(513)), {
      headers: { cookie },
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { details: { reason: 'invalid-groups-target' } },
    })
  })

  it('are read-only without push access', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn()
    world.directory.snapshot = { accounts: ['acme'], repos: [accessible('acme', 'shop', false)] }
    const calls: [string, RequestInit][] = [
      [apiPaths.groups(shop, source), jsonRequest('PUT', { groups: [], assignments: {} }, cookie)],
      [apiPaths.group(shop, source, 'billing'), jsonRequest('PUT', billingBody, cookie)],
      [apiPaths.group(shop, source, 'billing'), del(cookie)],
      [apiPaths.groupAssignments(shop, source), jsonRequest('PATCH', { assignments: {} }, cookie)],
      // Authorisation comes before the body.
      [apiPaths.groups(shop, source), jsonRequest('PUT', { groups: 'x' }, cookie)],
    ]
    for (const [path, init] of calls) expect((await world.app.request(path, init)).status).toBe(403)
    expect(world.tableGroups.stored.size).toBe(0)
  })

  it('limit the writes per user in real mode', async () => {
    const world = buildRealModeApp({
      userRateLimit: createRateLimiter({ limit: 2, windowMs: 60_000 }),
    })
    const cookie = await world.signIn()
    const put = () =>
      world.app.request(
        apiPaths.group(shop, source, 'billing'),
        jsonRequest('PUT', billingBody, cookie),
      )
    expect((await put()).status).toBe(204)
    expect((await put()).status).toBe(204)
    const limited = await put()
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).not.toBeNull()
  })

  it('work in fake mode too', async () => {
    const { app } = buildFakeModeApp()
    const read = await app.request(apiPaths.groups(shop, source))
    expect(await read.json()).toMatchObject({ configured: false, canEdit: true })
  })
})
