import {
  apiPaths,
  type BranchListResponse,
  MUTATION_HEADER,
  type SchemaResponse,
} from '@repoerd/contracts'
import { describe, expect, it } from 'vitest'
import { ParseQueueFullError } from '../../src/application/ports/schema-toolkit.js'
import { testRepoId } from '../fakes/in-memory-git-host.js'
import { buildFakeModeApp, jsonRequest, ODD_BRANCH } from './build-app.js'

const repo = { owner: 'acme', name: 'shop' }

describe('HTTP API (fake mode)', () => {
  it('sends an old name of a visible repository to its current name', async () => {
    const { app, directory } = buildFakeModeApp()
    directory.moved.set('acme/old-shop', {
      id: testRepoId('acme', 'shop'),
      owner: 'acme',
      name: 'shop',
    })
    const response = await app.request('/api/repos/acme/old-shop/branches')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: {
        code: 'repo_moved',
        message: 'Repository moved to acme/shop',
        details: { owner: 'acme', name: 'shop' },
      },
    })
  })

  it('serves the health check', async () => {
    const { app } = buildFakeModeApp()
    const response = await app.request('/healthz')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', version: 'test' })
  })

  it('reports an unreachable database as unhealthy', async () => {
    const { app, logged } = buildFakeModeApp({
      checkDatabase: () => {
        throw new Error('SQLITE_BUSY: database is locked')
      },
    })
    const response = await app.request('/healthz')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'error', version: 'test' })
    expect(logged).toEqual([
      { err: expect.objectContaining({ message: expect.stringContaining('SQLITE_BUSY') }) },
    ])
  })

  it('reports setup as done and signs the fake administrator in', async () => {
    const { app } = buildFakeModeApp()
    expect(await (await app.request(apiPaths.setupStatus)).json()).toEqual({
      mode: 'fake',
      state: 'ready',
      unlocked: false,
      publicUrl: null,
      app: null,
    })
    expect(await (await app.request('/api/me')).json()).toEqual({
      user: { id: 'fake-user', login: 'dev', avatarUrl: null, isAdmin: true },
      mode: 'fake',
    })
  })

  it('turns sign-in into a same-site redirect', async () => {
    const { app } = buildFakeModeApp()
    expect((await app.request(apiPaths.signIn('/acme/shop'))).headers.get('location')).toBe(
      '/acme/shop',
    )
    expect((await app.request(apiPaths.signIn('//evil.example'))).headers.get('location')).toBe('/')
  })

  it('lists the visible repositories', async () => {
    const { app } = buildFakeModeApp()
    expect(await (await app.request('/api/repos')).json()).toEqual({
      repos: [{ owner: 'acme', name: 'shop', defaultBranch: 'main', private: false }],
    })
  })

  it('lists branches with the default branch first', async () => {
    const { app } = buildFakeModeApp()
    const body = (await (await app.request(apiPaths.branches(repo))).json()) as BranchListResponse
    expect(body.defaultBranch).toBe('main')
    expect(body.branches.map((b) => b.name)).toEqual(['main', ODD_BRANCH])
    expect(body.truncated).toBe(false)
  })

  it('returns the schema of the default branch and of oddly named branches, without commit link', async () => {
    const { app } = buildFakeModeApp()
    const main = (await (await app.request(apiPaths.schema(repo))).json()) as SchemaResponse
    expect(main).toMatchObject({
      branch: 'main',
      failure: null,
      selectedSourceId: 'prisma/schema.prisma',
      commitUrl: null,
      treeTruncated: false,
    })
    expect(Object.keys(main.schema?.tables ?? {})).toEqual(['users'])

    const odd = (await (
      await app.request(apiPaths.schema(repo, { branch: ODD_BRANCH }))
    ).json()) as SchemaResponse
    expect(odd.branch).toBe(ODD_BRANCH)
    expect(Object.keys(odd.schema?.tables ?? {})).toEqual(['reviews'])
  })

  it('answers 404 for unknown and invisible repositories alike, and 400 for invalid names', async () => {
    const { app } = buildFakeModeApp()
    const unknown = await app.request('/api/repos/acme/nope/schema')
    const invisible = await app.request('/api/repos/acme/secret/schema')
    expect(unknown.status).toBe(404)
    expect(invisible.status).toBe(404)
    // Pinned exactly: gaining details on either side would tell the two cases apart.
    const notFound = { error: { code: 'repo_not_found', message: 'Repository not found' } }
    expect(await unknown.json()).toEqual(notFound)
    expect(await invisible.json()).toEqual(notFound)

    const unknownBranch = await app.request(apiPaths.schema(repo, { branch: 'missing' }))
    expect(unknownBranch.status).toBe(404)
    expect(await unknownBranch.json()).toEqual({
      error: {
        code: 'branch_not_found',
        message: 'Branch "missing" not found',
        details: { branch: 'missing' },
      },
    })

    // The CSRF check answers before any route: any mutating /api path without the header.
    const withoutHeader = await app.request('/api/anything', { method: 'PUT' })
    expect(withoutHeader.status).toBe(403)
    expect(await withoutHeader.json()).toMatchObject({
      error: { code: 'forbidden', details: { reason: 'missing-mutation-header' } },
    })

    expect((await app.request('/api/repos/acme/bad%20name/schema')).status).toBe(400)
    expect((await app.request('/api/nothing-here')).status).toBe(404)
  })

  it('saves and reads the layout of the current user; PUT keeps the other tables', async () => {
    const { app } = buildFakeModeApp()
    const path = apiPaths.layout(repo, 'prisma/schema.prisma', 'ALL_FIELDS')

    expect((await app.request('/api/repos/acme/shop/layout')).status).toBe(400)
    const invalidMode = await app.request(
      '/api/repos/acme/shop/layout?source=prisma%2Fschema.prisma&mode=COMPACT',
    )
    expect(invalidMode.status).toBe(400)
    expect(await invalidMode.json()).toMatchObject({ error: { message: 'Invalid display mode' } })
    const withoutHeader = await app.request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ positions: [] }),
    })
    expect(withoutHeader.status).toBe(403)
    expect(
      (await app.request(path, jsonRequest('PATCH', { positions: [{ table: 'a' }] }))).status,
    ).toBe(400)

    expect(
      (
        await app.request(
          path,
          jsonRequest('PATCH', { positions: [{ table: 'users', x: 10, y: 20 }] }),
        )
      ).status,
    ).toBe(204)
    expect(await (await app.request(path)).json()).toEqual({
      positions: [{ table: 'users', x: 10, y: 20 }],
    })

    expect(
      (await app.request(path, jsonRequest('PUT', { positions: [{ table: 'posts', x: 1, y: 1 }] })))
        .status,
    ).toBe(204)
    expect(await (await app.request(path)).json()).toEqual({
      positions: [
        { table: 'users', x: 10, y: 20 },
        { table: 'posts', x: 1, y: 1 },
      ],
    })
  })

  it('copies the layout of a moved source once asked to inherit', async () => {
    const { app } = buildFakeModeApp()
    const before = apiPaths.layout(repo, 'prisma/schema.prisma', 'ALL_FIELDS')
    const after = apiPaths.layout(repo, 'db/schema.prisma', 'ALL_FIELDS', { inherit: true })
    await app.request(before, jsonRequest('PATCH', { positions: [{ table: 'users', x: 3, y: 4 }] }))
    expect(after).toContain('inherit=1')
    expect(await (await app.request(after)).json()).toEqual({
      positions: [{ table: 'users', x: 3, y: 4 }],
    })
  })

  it('refuses layout writes on invisible repositories', async () => {
    const { app } = buildFakeModeApp()
    const path = apiPaths.layout(
      { owner: 'acme', name: 'secret' },
      'prisma/schema.prisma',
      'ALL_FIELDS',
    )
    expect((await app.request(path, jsonRequest('PATCH', { positions: [] }))).status).toBe(404)
  })

  it('refuses a 51st saved layout in a repository with the reason invalid-layout-target', async () => {
    const { app } = buildFakeModeApp()
    const save = (source: string) =>
      app.request(
        apiPaths.layout(repo, source, 'ALL_FIELDS'),
        jsonRequest('PATCH', { positions: [{ table: 'users', x: 0, y: 0 }] }),
      )
    for (let source = 0; source < 50; source++) expect((await save(`s${source}`)).status).toBe(204)
    const refused = await save('s50')
    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({
      error: {
        code: 'bad_request',
        message: 'At most 50 saved layouts per repository',
        details: { reason: 'invalid-layout-target' },
      },
    })
  })

  it('answers 503 server_busy when too many parses are waiting', async () => {
    const { app, logged, warned } = buildFakeModeApp({
      getBranchSchema: async () => {
        throw new ParseQueueFullError()
      },
    })
    const response = await app.request(apiPaths.schema(repo))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: { code: 'server_busy', message: 'The server is busy. Try again in a moment.' },
    })
    expect(logged).toHaveLength(0)
    expect(warned).toEqual([{ message: 'Too many parses are waiting: request refused' }])
  })

  it('logs unexpected errors and hides them behind a 500', async () => {
    const { app, logged } = buildFakeModeApp({
      getBranchSchema: async () => {
        throw new Error('database exploded')
      },
    })
    const response = await app.request(apiPaths.schema(repo))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: { code: 'internal_error', message: 'Unexpected server error' },
    })
    expect(logged).toHaveLength(1)
  })

  it('signs out without error', async () => {
    const { app } = buildFakeModeApp()
    const response = await app.request(apiPaths.logout, {
      method: 'POST',
      headers: { [MUTATION_HEADER]: '1' },
    })
    expect(response.status).toBe(204)
  })

  it('reloads the repository list on demand', async () => {
    const { app, directory } = buildFakeModeApp()
    expect((await app.request(apiPaths.reposRefresh)).status).toBe(200)
    expect(directory.reads.at(-1)?.options).toEqual({ refresh: true })
  })

  it('names its version on every API answer, errors included', async () => {
    const { app } = buildFakeModeApp()
    expect((await app.request('/api/repos')).headers.get('x-repoerd-version')).toBe('test')
    expect((await app.request('/api/nothing-here')).headers.get('x-repoerd-version')).toBe('test')
  })
})
