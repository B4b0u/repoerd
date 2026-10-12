import { apiPaths } from '@repoerd/contracts'
import { describe, expect, it } from 'vitest'
import { buildFakeModeApp, ODD_BRANCH } from './build-app.js'

const repo = { owner: 'acme', name: 'shop' }
const invalid = {
  error: {
    code: 'bad_request',
    message: 'Invalid branch name',
    details: { reason: 'invalid-branch-name' },
  },
}

describe('branch names in the API', () => {
  it.each(['../../../../acme/secret/git/ref/heads/main', 'a/../b', '.hidden', 'a b', 'a~1'])(
    'refuses the branch %j of a schema',
    async (branch) => {
      const { app } = buildFakeModeApp()
      const response = await app.request(apiPaths.schema(repo, { branch }))
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual(invalid)
    },
  )

  it('refuses an invalid reference branch or compared branch', async () => {
    const { app } = buildFakeModeApp()
    for (const params of [
      { base: '../main', head: 'main' },
      { base: 'main', head: 'feature/..' },
    ]) {
      const response = await app.request(apiPaths.compare(repo, params))
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual(invalid)
    }
  })

  it('accepts branch names that need encoding', async () => {
    const { app } = buildFakeModeApp()
    const schema = await app.request(apiPaths.schema(repo, { branch: ODD_BRANCH }))
    expect(schema.status).toBe(200)
    const compare = await app.request(apiPaths.compare(repo, { base: ODD_BRANCH }))
    expect(compare.status).toBe(200)
  })

  it('still answers 404 for invisible repositories before looking at the branch', async () => {
    const { app } = buildFakeModeApp()
    const response = await app.request('/api/repos/acme/secret/schema?branch=..')
    expect(response.status).toBe(404)
  })
})
