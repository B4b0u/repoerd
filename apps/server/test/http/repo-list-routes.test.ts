import { fileURLToPath } from 'node:url'
import {
  apiPaths,
  MUTATION_HEADER,
  type RepoFormatsResponse,
  type RepoListResponse,
} from '@repoerd/contracts'
import { describe, expect, it } from 'vitest'
import { FixtureGitHost } from '../../src/infrastructure/fake-github/fixture-git-host.js'
import { FixtureRepoDirectory } from '../../src/infrastructure/fake-github/fixture-repo-directory.js'
import { schemaCoreToolkit } from '../../src/infrastructure/schema/schema-core-toolkit.js'
import { testRepoId } from '../fakes/in-memory-git-host.js'
import { buildFakeModeApp, buildRealModeApp, jsonRequest, NOW, ODD_BRANCH } from './build-app.js'

const shop = { owner: 'acme', name: 'shop' }
const secret = { owner: 'acme', name: 'secret' }

const send = (method: 'PUT' | 'DELETE', cookie?: string): RequestInit => ({
  method,
  headers: { [MUTATION_HEADER]: '1', ...(cookie ? { cookie } : {}) },
})

type Requester = { request: (path: string, init?: RequestInit) => Response | Promise<Response> }

async function list(app: Requester, cookie?: string) {
  const response = await app.request('/api/repos', cookie ? { headers: { cookie } } : undefined)
  return ((await response.json()) as RepoListResponse).repos
}

describe('favourite routes', () => {
  it('star then unstar a repository', async () => {
    const { app } = buildFakeModeApp()
    expect((await app.request(apiPaths.favorite(shop), send('PUT'))).status).toBe(204)
    expect((await list(app))[0]?.favorite).toBe(true)
    expect((await app.request(apiPaths.favorite(shop), send('DELETE'))).status).toBe(204)
    expect((await list(app))[0]?.favorite).toBe(false)
  })

  it('answers 404 for a repository the user cannot see', async () => {
    const { app } = buildFakeModeApp()
    expect((await app.request(apiPaths.favorite(secret), send('PUT'))).status).toBe(404)
    expect((await app.request(apiPaths.favorite(secret), send('DELETE'))).status).toBe(404)
  })

  it('answers 409 too-many-favorites past the limit', async () => {
    const { app, favorites } = buildFakeModeApp()
    favorites.byUser.set('fake-user', new Set(Array.from({ length: 100 }, (_, i) => `other-${i}`)))
    const response = await app.request(apiPaths.favorite(shop), send('PUT'))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: { code: 'conflict', details: { reason: 'too-many-favorites', max: 100 } },
    })
  })

  it('needs the mutation header in real mode', async () => {
    const world = buildRealModeApp()
    const cookie = await world.signIn()
    const without = await world.app.request(apiPaths.favorite(shop), {
      method: 'PUT',
      headers: { cookie },
    })
    expect(without.status).toBe(403)
    expect((await world.app.request(apiPaths.favorite(shop), send('PUT', cookie))).status).toBe(204)
    expect((await list(world.app, cookie))[0]?.favorite).toBe(true)
  })
})

describe('visits', () => {
  it('opening the schema remembers the visit', async () => {
    const { app } = buildFakeModeApp()
    expect((await list(app))[0]?.lastOpenedAt).toBeNull()
    expect((await app.request(apiPaths.schema(shop))).status).toBe(200)
    expect((await list(app))[0]?.lastOpenedAt).toBe(NOW.toISOString())
  })

  it('opening a comparison remembers the visit', async () => {
    const { app } = buildFakeModeApp()
    const response = await app.request(apiPaths.compare(shop, { base: 'main', head: ODD_BRANCH }))
    expect(response.status).toBe(200)
    expect((await list(app))[0]?.lastOpenedAt).toBe(NOW.toISOString())
  })

  it('a failed schema leaves no visit', async () => {
    const { app } = buildFakeModeApp()
    await app.request(apiPaths.schema(shop, { branch: 'nope' }))
    expect((await list(app))[0]?.lastOpenedAt).toBeNull()
  })

  it('a visit that cannot be saved is logged and the response still succeeds', async () => {
    const { app, visits, warned } = buildFakeModeApp()
    visits.failNext = true
    expect((await app.request(apiPaths.schema(shop))).status).toBe(200)
    expect(warned.length).toBe(1)
  })
})

async function formats(app: Requester, cookie?: string) {
  const response = await app.request(
    apiPaths.repoFormats,
    cookie ? { headers: { cookie } } : undefined,
  )
  expect(response.status).toBe(200)
  const body = (await response.json()) as RepoFormatsResponse
  return Object.fromEntries(
    body.formats.map(({ owner, name, ...rest }) => [`${owner}/${name}`, rest]),
  )
}

/** Fake mode on the demo fixtures, detected by the real schema-core. */
async function fixturesApp() {
  const gitHost = new FixtureGitHost(
    fileURLToPath(new URL('../../../../fixtures/repos/', import.meta.url)),
  )
  const visible = (await new FixtureRepoDirectory(gitHost).forUser()).repos
  return buildFakeModeApp({ repositories: { gitHost, visible, toolkit: schemaCoreToolkit } })
}

describe('repository formats', () => {
  it('detects the formats of the fixtures in the background', async () => {
    const { app, formatSync } = await fixturesApp()
    const first = await formats(app)
    expect(first['acme/storefront']).toEqual({ format: null, formatPending: true })
    await formatSync.idle()
    const known = await formats(app)
    expect(known['acme/storefront']).toEqual({
      format: { kind: 'prisma', checkedAt: NOW.toISOString() },
      formatPending: false,
    })
    expect(known['acme/no-schema']?.format?.kind).toBe('none')
    expect((await list(app)).find((repo) => repo.name === 'storefront')?.format?.kind).toBe(
      'prisma',
    )
  })

  it('records the format when the default branch is opened', async () => {
    const { app, repoFormats, formatSync } = buildFakeModeApp()
    expect((await app.request(apiPaths.schema(shop))).status).toBe(200)
    expect(repoFormats.rows.get(String(testRepoId('acme', 'shop')))?.format).toBe('prisma')
    expect((await formats(app))['acme/shop']).toMatchObject({
      format: { kind: 'prisma' },
      formatPending: false,
    })
    await formatSync.idle()
  })

  it('marks the format to re-check when the manual sources are saved', async () => {
    const { app, repoFormats, formatSync } = buildFakeModeApp()
    await app.request(apiPaths.schema(shop))
    const body = { sources: [{ name: 'core', format: 'prisma', paths: ['prisma'] }] }
    const saved = await app.request(apiPaths.repoSettings(shop), jsonRequest('PUT', body))
    expect(saved.status).toBe(200)
    expect(repoFormats.rows.get(String(testRepoId('acme', 'shop')))?.stale).toBe(true)
    await formatSync.idle()
  })

  it('needs a signed-in user in real mode', async () => {
    const world = buildRealModeApp()
    expect((await world.app.request(apiPaths.repoFormats)).status).toBe(401)
    const cookie = await world.signIn()
    expect(await formats(world.app, cookie)).toEqual({
      'acme/shop': { format: null, formatPending: true },
    })
    await world.formatSync.idle()
  })
})
