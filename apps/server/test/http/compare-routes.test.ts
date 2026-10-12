import { apiPaths, type CompareResponse } from '@repoerd/contracts'
import { describe, expect, it } from 'vitest'
import { buildFakeModeApp, buildRealModeApp, ODD_BRANCH } from './build-app.js'

const repo = { owner: 'acme', name: 'shop' }
const tables = (side: CompareResponse['before']) => Object.keys(side.schema?.tables ?? {})

describe('GET /api/repos/:owner/:repo/compare', () => {
  it('compares two branches from their merge base', async () => {
    const { app } = buildFakeModeApp()
    const response = await app.request(apiPaths.compare(repo, { base: 'main', head: ODD_BRANCH }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as CompareResponse

    expect(body).toMatchObject({
      repo,
      mode: 'merge-base',
      base: { branch: 'main', commitUrl: null },
      head: { branch: ODD_BRANCH, commitUrl: null },
      selectedSourceId: 'prisma/schema.prisma',
      treeTruncated: false,
    })
    // The in-memory host answers the base head as merge base when nothing is declared.
    expect(body.mergeBaseSha).toBe(body.base.commitSha)
    expect(tables(body.before)).toEqual(['users'])
    expect(tables(body.after)).toEqual(['reviews'])
    expect(body.before.failure).toBeNull()
    expect(body.sources.map((s) => s.id)).toEqual(['prisma/schema.prisma'])
  })

  it('accepts an oddly named reference branch and compares the default branch with it', async () => {
    const { app } = buildFakeModeApp()
    const response = await app.request(apiPaths.compare(repo, { base: ODD_BRANCH, mode: 'direct' }))
    const body = (await response.json()) as CompareResponse
    expect(body).toMatchObject({ base: { branch: ODD_BRANCH }, head: { branch: 'main' } })
    expect(body.mergeBaseSha).toBeNull()
    expect(tables(body.before)).toEqual(['reviews'])
    expect(tables(body.after)).toEqual(['users'])
  })

  it('links the commits to GitHub in real mode', async () => {
    const { app, signIn } = buildRealModeApp()
    const cookie = await signIn()
    const response = await app.request(apiPaths.compare(repo, { base: 'main', head: ODD_BRANCH }), {
      headers: { cookie },
    })
    const body = (await response.json()) as CompareResponse
    const link = (sha: string) => `https://github.com/acme/shop/commit/${sha}`
    expect(body.base.commitUrl).toBe(link(body.base.commitSha))
    expect(body.head.commitUrl).toBe(link(body.head.commitSha))
    expect(body.before.commitUrl).toBe(link(body.before.commitSha))
    expect(body.after.commitUrl).toBe(link(body.after.commitSha))
  })

  it('answers 404 for invisible repositories and names the side of a missing branch', async () => {
    const { app } = buildFakeModeApp()
    const invisible = await app.request('/api/repos/acme/secret/compare?base=main&head=x')
    expect(invisible.status).toBe(404)
    expect(await invisible.json()).toEqual({
      error: { code: 'repo_not_found', message: 'Repository not found' },
    })

    const head = await app.request(apiPaths.compare(repo, { base: 'main', head: 'gone' }))
    expect(head.status).toBe(404)
    expect(await head.json()).toMatchObject({
      error: { code: 'branch_not_found', details: { branch: 'gone', side: 'head' } },
    })
    const base = await app.request(apiPaths.compare(repo, { base: 'gone' }))
    expect(await base.json()).toMatchObject({
      error: { code: 'branch_not_found', details: { branch: 'gone', side: 'base' } },
    })
  })

  it.each([
    ['no reference branch', '/api/repos/acme/shop/compare?head=main'],
    ['an unknown mode', '/api/repos/acme/shop/compare?base=main&head=x&mode=both'],
    ['a branch compared with itself', '/api/repos/acme/shop/compare?base=main'],
  ])('refuses %s with the reason invalid-compare', async (_case, path) => {
    const { app } = buildFakeModeApp()
    const response = await app.request(path)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'bad_request', details: { reason: 'invalid-compare' } },
    })
  })

  it('answers 409 when the branches share no history', async () => {
    const { app } = buildFakeModeApp({ mergeBases: { [`main...${ODD_BRANCH}`]: null } })
    const response = await app.request(apiPaths.compare(repo, { base: 'main', head: ODD_BRANCH }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'no_common_history' } })
  })
})
